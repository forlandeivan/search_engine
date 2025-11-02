import { EventEmitter } from "events";
import { randomUUID, createHash } from "crypto";
import fetch, { type RequestInit } from "node-fetch";
import { load } from "cheerio";
import { URL } from "url";
import { and, eq } from "drizzle-orm";
import { knowledgeDocuments, knowledgeNodes } from "@shared/schema";
import {
  type KnowledgeBaseCrawlConfig,
  type KnowledgeBaseCrawlJobStatus,
  type KnowledgeBaseCrawlJobEvent,
} from "@shared/knowledge-base";
import { db } from "./db";
import { createKnowledgeDocument, updateKnowledgeDocument } from "./knowledge-base";
import { createKnowledgeDocumentChunkSet } from "./knowledge-chunks";

const DEFAULT_RATE_LIMIT = 1;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_USER_AGENT = "UnicaDocSearchBot/1.0";

const MIN_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TERMINAL_JOB_STATUSES: Array<KnowledgeBaseCrawlJobStatus["status"]> = [
  "failed",
  "canceled",
  "done",
];

type CrawlQueueItem = {
  url: string;
  depth: number;
};

type InternalJobState = {
  jobId: string;
  workspaceId: string;
  baseId: string;
  config: KnowledgeBaseCrawlConfig;
  status: KnowledgeBaseCrawlJobStatus;
  emitter: EventEmitter;
  paused: boolean;
  canceled: boolean;
  queue: CrawlQueueItem[];
  visited: Set<string>;
  regexInclude: RegExp[];
  regexExclude: RegExp[];
  allowedHosts: Set<string> | null;
};

const jobs = new Map<string, InternalJobState>();

function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!url.protocol.startsWith("http")) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function toHostSet(domains?: string[] | null): Set<string> | null {
  if (!domains || domains.length === 0) {
    return null;
  }
  const entries = domains
    .map((entry) => {
      try {
        const url = new URL(entry.startsWith("http") ? entry : `https://${entry}`);
        return url.hostname;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 0 ? new Set(entries) : null;
}

function compilePatterns(patterns?: string[] | null): RegExp[] {
  if (!patterns) {
    return [];
  }
  return patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter((pattern): pattern is RegExp => pattern instanceof RegExp);
}

function matchesAny(target: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(target));
}

function emit(job: InternalJobState): void {
  job.status.updatedAt = new Date().toISOString();
  job.emitter.emit("update", { ...job.status });
}

async function upsertDocument({
  workspaceId,
  baseId,
  url,
  title,
  content,
  language,
  versionTag,
  metadata,
}: {
  workspaceId: string;
  baseId: string;
  url: string;
  title: string;
  content: string;
  language?: string | null;
  versionTag?: string | null;
  metadata: Record<string, unknown>;
}): Promise<"created" | "updated" | "skipped"> {
  const normalizedContent = content.trim();
  const hash = createHash("sha256").update(normalizedContent).digest("hex");

  let existing;
  try {
    [existing] = await db
      .select({
        documentId: knowledgeDocuments.id,
        nodeId: knowledgeDocuments.nodeId,
        contentHash: knowledgeDocuments.contentHash,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.baseId, baseId),
          eq(knowledgeDocuments.workspaceId, workspaceId),
          eq(knowledgeDocuments.sourceUrl, url),
        ),
      )
      .limit(1);
  } catch (error) {
    console.error("[KB-CRAWLER] Ошибка при проверке существующего документа:", {
      baseId,
      workspaceId,
      url,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  const now = new Date();

  if (!existing) {
    const created = await createKnowledgeDocument(baseId, workspaceId, {
      title: title || url,
      content: normalizedContent,
      sourceType: "crawl",
    });

    try {
      await db
        .update(knowledgeDocuments)
        .set({
          sourceUrl: url,
          contentHash: hash,
          language: language ?? null,
          versionTag: versionTag ?? null,
          crawledAt: now,
          metadata,
        })
        .where(eq(knowledgeDocuments.id, created.documentId));
    } catch (error) {
      console.error("[KB-CRAWLER] Ошибка при обновлении нового документа:", {
        documentId: created.documentId,
        baseId,
        workspaceId,
        url,
        hasContentHash: !!hash,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }

    await db
      .update(knowledgeNodes)
      .set({ sourceConfig: { sourceUrl: url } })
      .where(eq(knowledgeNodes.id, created.id));

    try {
      await createKnowledgeDocumentChunkSet(baseId, created.id, workspaceId, {});
    } catch (error) {
      console.error("[KB-CRAWLER] Не удалось автоматически разбить документ на чанки:", {
        baseId,
        nodeId: created.id,
        workspaceId,
        url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    return "created";
  }

  if (existing.contentHash === hash) {
    await db
      .update(knowledgeDocuments)
      .set({ crawledAt: now, metadata })
      .where(eq(knowledgeDocuments.id, existing.documentId));
    return "skipped";
  }

  await updateKnowledgeDocument(baseId, existing.nodeId, workspaceId, {
    title: title || url,
    content: normalizedContent,
  });

  await db
    .update(knowledgeDocuments)
    .set({
      contentHash: hash,
      language: language ?? null,
      versionTag: versionTag ?? null,
      crawledAt: now,
      metadata,
    })
    .where(eq(knowledgeDocuments.id, existing.documentId));

  try {
    await createKnowledgeDocumentChunkSet(baseId, existing.nodeId, workspaceId, {});
  } catch (error) {
    console.error("[KB-CRAWLER] Не удалось обновить чанки документа:", {
      baseId,
      nodeId: existing.nodeId,
      workspaceId,
      url,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  return "updated";
}

async function fetchPage(url: string, config: KnowledgeBaseCrawlConfig): Promise<string> {
  const headers: Record<string, string> = {};
  const userAgent = config.userAgent?.trim() || DEFAULT_USER_AGENT;
  headers["User-Agent"] = userAgent;

  if (config.auth?.headers) {
    for (const [key, value] of Object.entries(config.auth.headers)) {
      headers[key] = value;
    }
  }

  const init: RequestInit = {
    headers,
    redirect: "follow",
  };

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  return text;
}

function extractContent(baseUrl: string, html: string, config: KnowledgeBaseCrawlConfig): {
  title: string;
  content: string;
  links: string[];
} {
  const $ = load(html);
  const selectorTitle = config.selectors?.title?.trim();
  const selectorContent = config.selectors?.content?.trim();

  const title = selectorTitle ? $(selectorTitle).first().text().trim() : $("title").first().text().trim();

  const contentRoot = selectorContent ? $(selectorContent) : $("body");
  const content = contentRoot.text().replace(/\s+/g, " ").trim();

  const links = new Set<string>();
  $("a[href]")
    .map((_, element) => $(element).attr("href"))
    .get()
    .forEach((href) => {
      if (!href) return;
      try {
        const resolved = new URL(href, baseUrl).toString();
        const normalized = normalizeUrl(resolved);
        if (normalized) {
          links.add(normalized);
        }
      } catch {
        // ignore invalid links
      }
    });

  return { title, content, links: Array.from(links) };
}

async function processJob(job: InternalJobState): Promise<void> {
  const { config } = job;
  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
  const rateLimit = config.rateLimitRps ?? DEFAULT_RATE_LIMIT;
  const delay = Math.max(1000 / Math.max(rateLimit, 1), MIN_DELAY_MS);

  job.status.phase = "crawling";
  emit(job);

  while (job.queue.length > 0) {
    if (job.canceled) {
      job.status.phase = "canceled";
      job.status.status = "canceled";
      job.status.finishedAt = new Date().toISOString();
      emit(job);
      return;
    }

    if (job.paused) {
      job.status.phase = "paused";
      job.status.status = "paused";
      emit(job);
      await sleep(1000);
      continue;
    }

    if (job.status.saved >= maxPages) {
      break;
    }

    const next = job.queue.shift();
    if (!next) {
      break;
    }

    const normalizedUrl = normalizeUrl(next.url);
    if (!normalizedUrl) {
      continue;
    }

    if (job.visited.has(normalizedUrl)) {
      continue;
    }
    job.visited.add(normalizedUrl);

    if (job.allowedHosts) {
      const host = new URL(normalizedUrl).hostname;
      if (!job.allowedHosts.has(host)) {
        continue;
      }
    }

    if (matchesAny(normalizedUrl, job.regexExclude)) {
      continue;
    }

    if (job.regexInclude.length > 0 && !matchesAny(normalizedUrl, job.regexInclude)) {
      continue;
    }

    job.status.queued = job.queue.length;
    job.status.lastUrl = normalizedUrl;
    emit(job);

    try {
      const html = await fetchPage(normalizedUrl, config);
      job.status.fetched += 1;

      const { title, content, links } = extractContent(normalizedUrl, html, config);
      job.status.extracted += 1;

      const metadata = {
        sourceUrl: normalizedUrl,
        extractedAt: new Date().toISOString(),
        status: "fetched",
      };

      const result = await upsertDocument({
        workspaceId: job.workspaceId,
        baseId: job.baseId,
        url: normalizedUrl,
        title,
        content,
        language: config.language,
        versionTag: config.version,
        metadata,
      });

      if (result === "created") {
        job.status.saved += 1;
        job.status.pagesNew = (job.status.pagesNew ?? 0) + 1;
      } else if (result === "updated") {
        job.status.saved += 1;
        job.status.pagesUpdated = (job.status.pagesUpdated ?? 0) + 1;
      } else {
        job.status.pagesSkipped = (job.status.pagesSkipped ?? 0) + 1;
      }

      if (next.depth < maxDepth) {
        for (const link of links) {
          if (!job.visited.has(link)) {
            job.queue.push({ url: link, depth: next.depth + 1 });
          }
        }
        job.status.queued = job.queue.length;
        job.status.discovered = job.visited.size + job.queue.length;
      }

      job.status.percent = Math.min(99, Math.round((job.status.saved / Math.max(maxPages, 1)) * 100));
      emit(job);
    } catch (error) {
      job.status.failed += 1;
      job.status.errorsCount = (job.status.errorsCount ?? 0) + 1;
      job.status.lastError = error instanceof Error ? error.message : String(error);
      emit(job);
    }

    await sleep(delay);
  }

  job.status.phase = "done";
  job.status.status = "done";
  job.status.percent = 100;
  job.status.finishedAt = new Date().toISOString();
  job.status.durationSec =
    (new Date(job.status.finishedAt).getTime() - new Date(job.status.startedAt).getTime()) / 1000;
  emit(job);
}

export function startKnowledgeBaseCrawl(
  workspaceId: string,
  baseId: string,
  config: KnowledgeBaseCrawlConfig,
): KnowledgeBaseCrawlJobStatus {
  const jobId = randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  const initialQueue: CrawlQueueItem[] = [];
  for (const url of config.startUrls ?? []) {
    const normalized = normalizeUrl(url);
    if (normalized) {
      initialQueue.push({ url: normalized, depth: 0 });
    }
  }

  if (initialQueue.length === 0) {
    throw new Error("Не заданы стартовые URL для краулинга");
  }

  const state: InternalJobState = {
    jobId,
    workspaceId,
    baseId,
    config,
    emitter,
    paused: false,
    canceled: false,
    queue: initialQueue,
    visited: new Set(),
    regexInclude: compilePatterns(config.include),
    regexExclude: compilePatterns(config.exclude),
    allowedHosts: toHostSet(config.allowedDomains),
    status: {
      jobId,
      baseId,
      workspaceId,
      phase: "created",
      percent: 0,
      discovered: 0,
      queued: initialQueue.length,
      fetched: 0,
      extracted: 0,
      saved: 0,
      failed: 0,
      pagesTotal: config.maxPages ?? DEFAULT_MAX_PAGES,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
    },
  };

  jobs.set(jobId, state);
  processJob(state).catch((error) => {
    state.status.phase = "failed";
    state.status.status = "failed";
    state.status.lastError = error instanceof Error ? error.message : String(error);
    state.status.finishedAt = new Date().toISOString();
    emit(state);
  });

  return { ...state.status };
}

export function retryKnowledgeBaseCrawl(
  jobId: string,
  workspaceId: string,
): KnowledgeBaseCrawlJobStatus | null {
  const state = jobs.get(jobId);
  if (!state || state.workspaceId !== workspaceId) {
    return null;
  }

  if (!TERMINAL_JOB_STATUSES.includes(state.status.status)) {
    throw new Error("Задача краулинга ещё выполняется и не может быть перезапущена");
  }

  return startKnowledgeBaseCrawl(state.workspaceId, state.baseId, state.config);
}

export function getKnowledgeBaseCrawlJob(jobId: string): KnowledgeBaseCrawlJobStatus | null {
  const state = jobs.get(jobId);
  if (!state) {
    return null;
  }
  return { ...state.status };
}

export function subscribeKnowledgeBaseCrawlJob(
  jobId: string,
  listener: (event: KnowledgeBaseCrawlJobEvent) => void,
): (() => void) | null {
  const state = jobs.get(jobId);
  if (!state) {
    return null;
  }
  state.emitter.on("update", listener);
  return () => {
    state.emitter.off("update", listener);
  };
}

export function pauseKnowledgeBaseCrawl(jobId: string): KnowledgeBaseCrawlJobStatus | null {
  const state = jobs.get(jobId);
  if (!state) {
    return null;
  }
  state.paused = true;
  state.status.phase = "paused";
  state.status.status = "paused";
  emit(state);
  return { ...state.status };
}

export function resumeKnowledgeBaseCrawl(jobId: string): KnowledgeBaseCrawlJobStatus | null {
  const state = jobs.get(jobId);
  if (!state) {
    return null;
  }
  state.paused = false;
  state.status.phase = "crawling";
  state.status.status = "running";
  emit(state);
  return { ...state.status };
}

export function cancelKnowledgeBaseCrawl(jobId: string): KnowledgeBaseCrawlJobStatus | null {
  const state = jobs.get(jobId);
  if (!state) {
    return null;
  }
  state.canceled = true;
  state.status.phase = "canceled";
  state.status.status = "canceled";
  state.status.finishedAt = new Date().toISOString();
  emit(state);
  return { ...state.status };
}

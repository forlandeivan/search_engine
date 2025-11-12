import { EventEmitter } from "events";
import { randomUUID, createHash } from "crypto";
import { load } from "cheerio";
import { marked } from "marked";
import { URL } from "url";
import { and, eq } from "drizzle-orm";
import fetch, { Headers } from "node-fetch";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { knowledgeDocuments, knowledgeNodes } from "@shared/schema";
import {
  type KnowledgeBaseCrawlConfig,
  type KnowledgeBaseCrawlJobStatus,
  type KnowledgeBaseCrawlJobEvent,
  type KnowledgeBaseCrawlSelectorConfig,
  type KnowledgeBaseCrawlAuthConfig,
  type KnowledgeBaseDocumentDetail,
} from "@shared/knowledge-base";
import { db } from "./db";
import {
  createKnowledgeDocument,
  updateKnowledgeDocument,
  getKnowledgeNodeDetail,
  KnowledgeBaseError,
} from "./knowledge-base";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

turndown.use(gfm);

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

async function fetchPageHtml(
  url: string,
  options: { userAgent?: string; headers?: Record<string, string> } = {},
): Promise<{ html: string; statusCode: number; finalUrl: string }> {
  const headerInit = new Headers();
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof key === "string" && key.trim().length > 0 && typeof value === "string") {
        headerInit.set(key, value);
      }
    }
  }

  if (options.userAgent?.trim()) {
    headerInit.set("User-Agent", options.userAgent.trim());
  }

  const response = await fetch(url, {
    headers: headerInit,
    redirect: "follow",
  });

  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.includes("text/html")) {
    throw new Error(`Неподдерживаемый тип контента: ${contentType}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const finalUrl = response.url ?? url;

  return {
    html,
    statusCode: response.status,
    finalUrl,
  };
}

async function extractStructuredContentFromHtml(
  rawHtml: string,
  pageUrl: string,
  canonicalUrl?: string,
  fallbackTitle?: string,
): Promise<{
  html: string;
  markdown: string;
  aggregatedText: string;
  title?: string;
  outLinks: string[];
  plainText: string;
  stats: {
    headingCount: number;
    listCount: number;
    tableCount: number;
    codeBlockCount: number;
  };
}> {
  const baseUrl = canonicalUrl ?? pageUrl;
  const dom = new JSDOM(rawHtml, { url: baseUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const articleHtml = article?.content?.trim() ? article.content : rawHtml;
  const articleTitle = article?.title?.trim() || fallbackTitle || undefined;
  const textContent = article?.textContent?.trim() || dom.window.document.body?.textContent?.trim() || "";

  let markdown = "";
  try {
    markdown = turndown.turndown(articleHtml);
  } catch (error) {
    console.warn("[KB-CRAWLER] Не удалось преобразовать HTML в Markdown", {
      error: error instanceof Error ? error.message : String(error),
    });
    markdown = textContent;
  }

  const $ = load(articleHtml);
  const stats = {
    headingCount: $("h1, h2, h3, h4, h5, h6").length,
    listCount: $("ul, ol").length,
    tableCount: $("table").length,
    codeBlockCount: $("pre, code").length,
  };

  const outLinks = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }
    try {
      const resolved = new URL(href, baseUrl).toString();
      outLinks.add(resolved);
    } catch {
      // ignore invalid URLs
    }
  });

  return {
    html: articleHtml,
    markdown,
    aggregatedText: textContent,
    plainText: textContent,
    title: articleTitle,
    outLinks: Array.from(outLinks),
    stats,
  };
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

type UpsertDocumentParams = {
  workspaceId: string;
  baseId: string;
  parentId?: string | null;
  url: string;
  title: string;
  contentHtml: string;
  contentMarkdown: string;
  contentPlainText: string;
  language?: string | null;
  versionTag?: string | null;
  metadata: Record<string, unknown>;
};

type UpsertDocumentResult = {
  status: "created" | "updated" | "skipped";
  nodeId: string;
  documentId: string;
};

async function upsertDocument({
  workspaceId,
  baseId,
  parentId,
  url,
  title,
  contentHtml,
  contentMarkdown,
  contentPlainText,
  language,
  versionTag,
  metadata,
}: UpsertDocumentParams): Promise<UpsertDocumentResult> {
  const normalizedMarkdown = contentMarkdown.trim();
  const normalizedHtml = contentHtml.trim();
  const normalizedPlainText = contentPlainText.trim() || normalizedMarkdown || normalizedHtml;
  const hashSource = normalizedMarkdown || normalizedHtml;
  const hash = hashSource ? createHash("sha256").update(hashSource).digest("hex") : null;
  const normalizedTitle = title?.trim() || url;

  let existing:
    | {
        documentId: string;
        nodeId: string;
        contentHash: string | null;
      }
    | undefined;
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
      title: normalizedTitle,
      content: normalizedHtml,
      contentMarkdown: normalizedMarkdown,
      contentPlainText: normalizedPlainText,
      sourceType: "crawl",
      parentId: parentId ?? null,
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

    return { status: "created", nodeId: created.id, documentId: created.documentId };
  }

  if (existing.contentHash === hash) {
    await db
      .update(knowledgeDocuments)
      .set({
        crawledAt: now,
        metadata,
        language: language ?? null,
        versionTag: versionTag ?? null,
      })
      .where(eq(knowledgeDocuments.id, existing.documentId));

    await db
      .update(knowledgeNodes)
      .set({ sourceConfig: { sourceUrl: url } })
      .where(eq(knowledgeNodes.id, existing.nodeId));

    return { status: "skipped", nodeId: existing.nodeId, documentId: existing.documentId };
  }

  await updateKnowledgeDocument(baseId, existing.nodeId, workspaceId, {
    title: normalizedTitle,
    content: normalizedHtml,
    contentMarkdown: normalizedMarkdown,
    contentPlainText: normalizedPlainText,
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

  await db
    .update(knowledgeNodes)
    .set({ sourceConfig: { sourceUrl: url } })
    .where(eq(knowledgeNodes.id, existing.nodeId));

  return { status: "updated", nodeId: existing.nodeId, documentId: existing.documentId };
}

type CrawlDocumentParams = {
  url: string;
  parentId?: string | null;
  selectors?: KnowledgeBaseCrawlSelectorConfig | null;
  language?: string | null;
  version?: string | null;
  auth?: KnowledgeBaseCrawlAuthConfig | null;
};

export async function crawlKnowledgeDocumentPage(
  workspaceId: string,
  baseId: string,
  params: CrawlDocumentParams,
): Promise<{ status: "created" | "updated" | "skipped"; document: KnowledgeBaseDocumentDetail }>
{
  const normalizedUrl = normalizeUrl(params.url);
  if (!normalizedUrl) {
    throw new KnowledgeBaseError("Укажите корректный URL страницы", 400);
  }

  const selectors = params.selectors
    ? {
        title: params.selectors.title?.trim() || null,
        content: params.selectors.content?.trim() || null,
      }
    : null;
  const language = params.language?.trim() || null;
  const version = params.version?.trim() || null;

  const config: KnowledgeBaseCrawlConfig = {
    startUrls: [normalizedUrl],
    sitemapUrl: null,
    allowedDomains: undefined,
    include: undefined,
    exclude: undefined,
    maxPages: 1,
    maxDepth: 0,
    rateLimitRps: null,
    robotsTxt: true,
    selectors,
    language,
    version,
    auth: params.auth ?? null,
  };

  let html: string;
  try {
    html = await fetchPage(normalizedUrl, config);
  } catch (error) {
    console.error("[KB-CRAWLER] Не удалось загрузить страницу для импорта:", {
      url: normalizedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new KnowledgeBaseError("Не удалось загрузить страницу по указанной ссылке", 502);
  }

  let extracted: Awaited<ReturnType<typeof extractContent>>;
  try {
    extracted = await extractContent(normalizedUrl, html, config);
  } catch (error) {
    console.error("[KB-CRAWLER] Не удалось обработать содержимое страницы:", {
      url: normalizedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new KnowledgeBaseError("Не удалось обработать содержимое страницы", 500);
  }

  const metadata = {
    sourceUrl: normalizedUrl,
    extractedAt: new Date().toISOString(),
    status: "fetched" as const,
    structureStats: extracted.stats,
    markdownLength: extracted.markdown.length,
  };

  const result = await upsertDocument({
    workspaceId,
    baseId,
    parentId: params.parentId ?? null,
    url: normalizedUrl,
    title: extracted.title,
    contentHtml: extracted.html,
    contentMarkdown: extracted.markdown,
    contentPlainText: extracted.plainText,
    language,
    versionTag: version,
    metadata,
  });

  const detail = await getKnowledgeNodeDetail(baseId, result.nodeId, workspaceId);
  if (detail.type !== "document") {
    throw new KnowledgeBaseError("Не удалось получить данные документа после импорта", 500);
  }

  return { status: result.status, document: detail };
}

async function fetchPage(url: string, config: KnowledgeBaseCrawlConfig): Promise<string> {
  const userAgent = config.userAgent?.trim() || DEFAULT_USER_AGENT;
  const headers: Record<string, string> = {};

  if (config.auth?.headers) {
    for (const [key, value] of Object.entries(config.auth.headers)) {
      if (typeof key === "string" && key.trim().length > 0 && typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const { html } = await fetchPageHtml(url, {
    userAgent,
    headers,
  });

  return html;
}

async function extractContent(
  baseUrl: string,
  html: string,
  config: KnowledgeBaseCrawlConfig,
): Promise<{
  title: string;
  markdown: string;
  html: string;
  plainText: string;
  links: string[];
  stats: {
    headingCount: number;
    listCount: number;
    tableCount: number;
    codeBlockCount: number;
  };
}> {
  const $ = load(html);
  const selectorTitle = config.selectors?.title?.trim();
  const selectorContent = config.selectors?.content?.trim();

  const fallbackTitle = selectorTitle ? $(selectorTitle).first().text().trim() : $("title").first().text().trim();

  const contentRoot = selectorContent ? $(selectorContent) : null;
  const selectionHtml = contentRoot && contentRoot.length > 0 ? contentRoot.html() ?? "" : "";
  const extractionHtml = selectionHtml.trim() ? `<article>${selectionHtml}</article>` : html;

  const structured = await extractStructuredContentFromHtml(
    extractionHtml,
    baseUrl,
    baseUrl,
    fallbackTitle,
  );

  const structuredTitle = structured.title?.trim();
  let markdown = structured.markdown?.trim() ?? "";
  const plainText = structured.aggregatedText ?? "";
  if (!markdown && plainText) {
    markdown = plainText;
  }

  let renderedHtml = "";
  if (markdown) {
    const parsed = marked.parse(markdown, { gfm: true });
    renderedHtml = typeof parsed === "string" ? parsed : await parsed;
  }

  if (!renderedHtml.trim()) {
    if (selectionHtml.trim()) {
      renderedHtml = selectionHtml;
    } else if (plainText.trim()) {
      renderedHtml = `<p>${escapeHtml(plainText)}</p>`;
    } else {
      renderedHtml = html;
    }
  }

  const links = new Set<string>();
  structured.outLinks?.forEach((link) => {
    if (link) {
      links.add(link);
    }
  });

  $("a[href]")
    .map((_, element) => $(element).attr("href"))
    .get()
    .forEach((href) => {
      if (!href) {
        return;
      }
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

  return {
    title: structuredTitle || fallbackTitle,
    markdown,
    html: renderedHtml,
    plainText,
    links: Array.from(links),
    stats: structured.stats,
  };
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

      const {
        title,
        markdown,
        html: contentHtml,
        plainText,
        links,
        stats,
      } = await extractContent(normalizedUrl, html, config);
      job.status.extracted += 1;

      const metadata = {
        sourceUrl: normalizedUrl,
        extractedAt: new Date().toISOString(),
        status: "fetched",
        structureStats: stats,
        markdownLength: markdown.length,
      };

      const result = await upsertDocument({
        workspaceId: job.workspaceId,
        baseId: job.baseId,
        url: normalizedUrl,
        title,
        contentHtml,
        contentMarkdown: markdown,
        contentPlainText: plainText,
        language: config.language,
        versionTag: config.version,
        metadata,
      });

      if (result.status === "created") {
        job.status.saved += 1;
        job.status.pagesNew = (job.status.pagesNew ?? 0) + 1;
      } else if (result.status === "updated") {
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

export function getKnowledgeBaseCrawlJobStateForBase(
  baseId: string,
  workspaceId: string,
): {
  active: KnowledgeBaseCrawlJobStatus | null;
  latest: KnowledgeBaseCrawlJobStatus | null;
} {
  let active: InternalJobState | null = null;
  let latest: InternalJobState | null = null;

  for (const state of jobs.values()) {
    if (state.baseId !== baseId || state.workspaceId !== workspaceId) {
      continue;
    }

    if (!latest) {
      latest = state;
    } else {
      const currentUpdatedAt = new Date(state.status.updatedAt).getTime();
      const latestUpdatedAt = new Date(latest.status.updatedAt).getTime();
      if (currentUpdatedAt > latestUpdatedAt) {
        latest = state;
      }
    }

    if (!TERMINAL_JOB_STATUSES.includes(state.status.status)) {
      if (!active) {
        active = state;
      } else {
        const activeUpdatedAt = new Date(active.status.updatedAt).getTime();
        const stateUpdatedAt = new Date(state.status.updatedAt).getTime();
        if (stateUpdatedAt > activeUpdatedAt) {
          active = state;
        }
      }
    }
  }

  return {
    active: active ? { ...active.status } : null,
    latest: latest ? { ...latest.status } : null,
  };
}

export const __test__ = {
  extractStructuredContentFromHtml,
};

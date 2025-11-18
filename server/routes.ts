import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { createServer, type Server } from "http";
import fetch, {
  Headers,
  type Response as FetchResponse,
  type RequestInit as FetchRequestInit,
} from "node-fetch";
import { createHash, randomUUID, randomBytes } from "crypto";
import { performance } from "perf_hooks";
import { Agent as HttpsAgent } from "https";
import { storage } from "./storage";
import type { KnowledgeChunkSearchEntry, WorkspaceMemberWithUser } from "./storage";
import {
  startKnowledgeBaseCrawl,
  getKnowledgeBaseCrawlJob,
  getKnowledgeBaseCrawlJobStateForBase,
  subscribeKnowledgeBaseCrawlJob,
  pauseKnowledgeBaseCrawl,
  resumeKnowledgeBaseCrawl,
  cancelKnowledgeBaseCrawl,
  retryKnowledgeBaseCrawl,
  crawlKnowledgeDocumentPage,
} from "./kb-crawler";
import { z } from "zod";
import { invalidateCorsCache } from "./cors-cache";
import { getQdrantClient, QdrantConfigurationError } from "./qdrant";
import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import {
  buildLlmRequestBody,
  mergeLlmRequestConfig,
  mergeLlmResponseConfig,
  type LlmContextRecord,
  type RagResponseFormat,
} from "./search/utils";
import {
  listKnowledgeBases,
  getKnowledgeNodeDetail,
  deleteKnowledgeNode,
  updateKnowledgeNodeParent,
  KnowledgeBaseError,
  createKnowledgeBase,
  deleteKnowledgeBase,
  createKnowledgeFolder,
  createKnowledgeDocument,
  updateKnowledgeDocument,
} from "./knowledge-base";
import {
  previewKnowledgeDocumentChunks,
  createKnowledgeDocumentChunkSet,
  updateKnowledgeDocumentChunkVectorRecords,
} from "./knowledge-chunks";
import { listSkills, createSkill, updateSkill, deleteSkill, SkillServiceError, getSkillById } from "./skills";
import passport from "passport";
import bcrypt from "bcryptjs";
import {
  registerUserSchema,
  type PublicUser,
  type PersonalApiToken,
  userRoles,
  insertEmbeddingProviderSchema,
  updateEmbeddingProviderSchema,
  insertLlmProviderSchema,
  updateLlmProviderSchema,
  upsertAuthProviderSchema,
  type PublicEmbeddingProvider,
  type PublicLlmProvider,
  type EmbeddingProvider,
  type LlmProvider,
  type LlmModelOption,
  type LlmRequestConfig,
  type LlmResponseConfig,
  type AuthProviderInsert,
  type Site,
  type WorkspaceEmbedKey,
  DEFAULT_QDRANT_CONFIG,
  DEFAULT_LLM_REQUEST_CONFIG,
  DEFAULT_LLM_RESPONSE_CONFIG,
  workspaceMemberRoles,
  type KnowledgeBaseAskAiPipelineStepLog,
} from "@shared/schema";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";
import type { KnowledgeBaseSearchSettingsRow } from "@shared/schema";
import { createSkillSchema, updateSkillSchema } from "@shared/skills";
import type {
  KnowledgeDocumentVectorizationJobStatus,
  KnowledgeDocumentVectorizationJobResult,
  KnowledgeBaseCrawlJobStatus,
  KnowledgeBaseCrawlConfig,
  KnowledgeBaseRagConfigResponse,
  KnowledgeBaseAskAiRunListResponse,
  KnowledgeBaseAskAiRunDetail,
} from "@shared/knowledge-base";
import {
  KNOWLEDGE_BASE_SEARCH_CONSTRAINTS,
  mergeChunkSearchSettings,
  mergeRagSearchSettings,
  type KnowledgeBaseSearchSettingsResponsePayload,
} from "@shared/knowledge-base-search";
import {
  castValueToType,
  collectionFieldTypes,
  normalizeArrayValue,
  renderLiquidTemplate,
  type CollectionSchemaFieldInput,
} from "@shared/vectorization";
import {
  requireAuth,
  requireAdmin,
  getSessionUser,
  toPublicUser,
  reloadGoogleAuth,
  reloadYandexAuth,
  ensureWorkspaceContext,
  buildSessionResponse,
  getRequestWorkspace,
  getRequestWorkspaceMemberships,
  resolveOptionalUser,
  WorkspaceContextError,
} from "./auth";

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const segments: string[] = [];

    const baseMessage = typeof error.message === "string" ? error.message.trim() : "";
    if (baseMessage.length > 0) {
      segments.push(baseMessage);
    }

    const metadata = error as unknown as Record<string, unknown>;

    const appendDetail = (label: string) => {
      const value = metadata[label];
      if (typeof value === "string" && value.trim().length > 0) {
        segments.push(`${label}=${value.trim()}`);
      }
    };

    appendDetail("code");
    appendDetail("detail");
    appendDetail("hint");
    appendDetail("schema");
    appendDetail("table");
    appendDetail("column");
    appendDetail("constraint");

    const contextValue = metadata["context"];
    if (contextValue && typeof contextValue === "object") {
      try {
        segments.push(`context=${JSON.stringify(contextValue)}`);
      } catch {
        segments.push("context=[unserializable]");
      }
    }

    if (error.cause instanceof Error) {
      const causeMessage = error.cause.message?.trim();
      if (causeMessage) {
        segments.push(`cause=${causeMessage}`);
      }
    } else if (typeof error.cause === "string" && error.cause.trim().length > 0) {
      segments.push(`cause=${error.cause.trim()}`);
    }

    if (typeof error.stack === "string") {
      const [, firstStackLine] = error.stack.split("\n");
      if (firstStackLine) {
        segments.push(`stack=${firstStackLine.trim()}`);
      }
    }

    if (segments.length === 0) {
      segments.push(error.name || "Error");
    }

    return segments.join("; ");
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function createQueryPreview(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}вЂ¦`;
}

function maskSensitiveInfoInUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/:[^:@]*@/, ":***@");
  }
}

const chunkSearchConstraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.chunk;
const ragSearchConstraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.rag;

const chunkSearchSettingsSchema = z
  .object({
    topK: z.number().int().min(chunkSearchConstraints.topK.min).max(chunkSearchConstraints.topK.max).optional(),
    bm25Weight: z
      .number()
      .min(chunkSearchConstraints.bm25Weight.min)
      .max(chunkSearchConstraints.bm25Weight.max)
      .optional(),
    synonyms: z.array(z.string()).max(chunkSearchConstraints.synonyms.maxItems ?? 100).optional(),
    includeDrafts: z.boolean().optional(),
    highlightResults: z.boolean().optional(),
    filters: z.string().max(8000).optional(),
  })
  .partial();

const ragSearchSettingsSchema = z
  .object({
    topK: z.number().int().min(ragSearchConstraints.topK.min).max(ragSearchConstraints.topK.max).optional(),
    bm25Weight: z
      .number()
      .min(ragSearchConstraints.bm25Weight.min)
      .max(ragSearchConstraints.bm25Weight.max)
      .optional(),
    bm25Limit: z
      .number()
      .int()
      .min(ragSearchConstraints.bm25Limit.min)
      .max(ragSearchConstraints.bm25Limit.max)
      .nullable()
      .optional(),
    vectorWeight: z
      .number()
      .min(ragSearchConstraints.vectorWeight.min)
      .max(ragSearchConstraints.vectorWeight.max)
      .nullable()
      .optional(),
    vectorLimit: z
      .number()
      .int()
      .min(ragSearchConstraints.vectorLimit.min)
      .max(ragSearchConstraints.vectorLimit.max)
      .nullable()
      .optional(),
    embeddingProviderId: z.string().max(255).nullable().optional(),
    collection: z.string().max(255).nullable().optional(),
    llmProviderId: z.string().max(255).nullable().optional(),
    llmModel: z.string().max(255).nullable().optional(),
    temperature: z
      .number()
      .min(ragSearchConstraints.temperature.min)
      .max(ragSearchConstraints.temperature.max)
      .nullable()
      .optional(),
    maxTokens: z
      .number()
      .int()
      .min(ragSearchConstraints.maxTokens.min)
      .max(ragSearchConstraints.maxTokens.max)
      .nullable()
      .optional(),
    systemPrompt: z.string().max(8000).optional(),
    responseFormat: z.enum(["text", "markdown", "html"]).nullable().optional(),
  })
  .partial();

const knowledgeBaseSearchSettingsSchema = z
  .object({
    chunkSettings: chunkSearchSettingsSchema.optional(),
    ragSettings: ragSearchSettingsSchema.optional(),
  })
  .default({});

function normalizeTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function buildSearchSettingsResponse(
  record: KnowledgeBaseSearchSettingsRow | null,
): KnowledgeBaseSearchSettingsResponsePayload {
  const chunkSettings = mergeChunkSearchSettings(record?.chunkSettings ?? null);
  const ragSettings = mergeRagSearchSettings(record?.ragSettings ?? null, {
    topK: chunkSettings.topK,
    bm25Weight: chunkSettings.bm25Weight,
  });

  return {
    chunkSettings,
    ragSettings,
    updatedAt: normalizeTimestamp(record?.updatedAt ?? null),
  };
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function pickFirstString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function normalizeDomainCandidate(candidate: unknown): string | null {
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const withScheme = /^(https?:)?\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    return url.hostname.toLowerCase();
  } catch {
    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, "");
    const hostname = withoutScheme.split(/[/?#]/, 1)[0]?.split(":", 1)[0]?.trim() ?? "";
    return hostname ? hostname.toLowerCase() : null;
  }
}

function extractRequestDomain(req: Request, bodySource: Record<string, unknown>): string | null {
  const headerOrigin = Array.isArray(req.headers["x-embed-origin"]) ? req.headers["x-embed-origin"][0] : req.headers["x-embed-origin"];
  const headerCandidates = [
    headerOrigin,
    req.headers.origin,
    req.headers.referer,
  ];

  for (const value of headerCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  const queryCandidates = [
    req.query.origin,
    req.query.domain,
    req.query.host,
  ];

  for (const value of queryCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  const bodyCandidates = [bodySource.origin, bodySource.domain, bodySource.host];
  for (const value of bodyCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

interface PublicCollectionContext {
  apiKey?: string;
  workspaceId: string;
  site?: Site;
  embedKey?: WorkspaceEmbedKey;
  knowledgeBaseId?: string;
}

function normalizeResponseFormat(
  value: unknown,
): RagResponseFormat | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "md" || normalized === "markdown") {
    return "markdown";
  }

  if (normalized === "html") {
    return "html";
  }

  if (normalized === "text" || normalized === "plain") {
    return "text";
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function buildSourceSnippet(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    if (normalized.length > 240) {
      return `${normalized.slice(0, 240)}вЂ¦`;
    }

    return normalized;
  }

  return null;
}

function pickAbsoluteUrl(baseUrls: string[], ...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const direct = new URL(trimmed);
      return direct.toString();
    } catch {
      for (const base of baseUrls) {
        try {
          const resolved = new URL(trimmed, base);
          return resolved.toString();
        } catch {
          // ignore invalid base resolution
        }
      }
    }
  }

  return null;
}

async function resolvePublicCollectionRequest(
  req: Request,
  res: Response,
): Promise<PublicCollectionContext | null> {
  const bodySource: Record<string, unknown> =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? { ...(req.body as Record<string, unknown>) }
      : {};

  const headerKey = req.headers["x-api-key"];
  const apiKey = pickFirstString(
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    bodySource.apiKey,
    req.query.apiKey,
    req.query.apikey,
  );

  const paramPublicId = typeof req.params?.publicId === "string" ? req.params.publicId : undefined;
  const publicId = pickFirstString(
    paramPublicId,
    bodySource.publicId,
    bodySource.sitePublicId,
    req.query.publicId,
    req.query.sitePublicId,
    req.query.siteId,
  );

  const workspaceIdCandidate = pickFirstString(
    bodySource.workspaceId,
    bodySource.workspace_id,
    req.query.workspaceId,
    req.query.workspace_id,
  );

  const knowledgeBaseIdCandidate = pickFirstString(
    bodySource.kbId,
    bodySource.kb_id,
    req.query.kbId,
    req.query.kb_id,
  );

  const requestDomain = extractRequestDomain(req, bodySource);

  async function ensureWorkspaceAccess(targetWorkspaceId: string): Promise<boolean> {
    const workspaceMemberships = getRequestWorkspaceMemberships(req);
    if (workspaceMemberships.length > 0) {
      const hasAccess = workspaceMemberships.some((entry) => entry.id === targetWorkspaceId);
      if (!hasAccess) {
        res.status(403).json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ" });
        return false;
      }
    } else {
      const user = await resolveOptionalUser(req);
      if (user) {
        const isMember = await storage.isWorkspaceMember(targetWorkspaceId, user.id);
        if (!isMember) {
          res.status(403).json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ" });
          return false;
        }
      }
    }

    return true;
  }

  if (!apiKey) {
    let resolvedWorkspaceId = workspaceIdCandidate;

    if (!resolvedWorkspaceId) {
      const user = await resolveOptionalUser(req);
      if (!user) {
        res.status(401).json({ error: "РЈРєР°Р¶РёС‚Рµ X-API-Key РІ Р·Р°РіРѕР»РѕРІРєРµ РёР»Рё apiKey РІ Р·Р°РїСЂРѕСЃРµ" });
        return null;
      }

      try {
        const context = await ensureWorkspaceContext(req, user);
        resolvedWorkspaceId = context.active.id;
      } catch (error) {
        if (error instanceof WorkspaceContextError) {
          res.status(error.status).json({ error: error.message });
          return null;
        }
        throw error;
      }
    }

    if (!resolvedWorkspaceId) {
      res.status(400).json({ error: "РџРµСЂРµРґР°Р№С‚Рµ workspace_id РёР»Рё X-Workspace-Id" });
      return null;
    }

    if (!(await ensureWorkspaceAccess(resolvedWorkspaceId))) {
      return null;
    }

    if (knowledgeBaseIdCandidate) {
      const base = await storage.getKnowledgeBase(knowledgeBaseIdCandidate);
      if (!base) {
        res.status(404).json({ error: "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°" });
        return null;
      }

      if (base.workspaceId !== resolvedWorkspaceId) {
        res.status(403).json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє Р±Р°Р·Рµ Р·РЅР°РЅРёР№" });
        return null;
      }

      return { workspaceId: resolvedWorkspaceId, knowledgeBaseId: base.id };
    }

    return { workspaceId: resolvedWorkspaceId };
  }

  if (publicId) {
    if (!workspaceIdCandidate) {
      res.status(400).json({ error: "РџРµСЂРµРґР°Р№С‚Рµ workspace_id РІ С‚РµР»Рµ Р·Р°РїСЂРѕСЃР°" });
      return null;
    }

    console.log(
      `[RAG DEBUG] API Key: ${apiKey.substring(0, 10)}..., Workspace ID: ${workspaceIdCandidate}, Public ID: ${publicId}`,
    );

    if (!(await ensureWorkspaceAccess(workspaceIdCandidate))) {
      return null;
    }

    const site = await storage.getSiteByPublicId(publicId);

    if (!site) {
      res.status(404).json({ error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
      return null;
    }

    if (site.workspaceId !== workspaceIdCandidate) {
      res.status(403).json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ" });
      return null;
    }

    if (site.publicApiKey !== apiKey) {
      res.status(401).json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ API-РєР»СЋС‡" });
      return null;
    }

    return { site, apiKey, workspaceId: workspaceIdCandidate };
  }

  console.log(`[RAG DEBUG] Looking up site by API key...`);
  const site = await storage.getSiteByPublicApiKey(apiKey);

  if (site) {
    console.log(`[RAG DEBUG] getSiteByPublicApiKey result: found site ${site.id}, workspace ${site.workspaceId}`);

    if (workspaceIdCandidate && site.workspaceId !== workspaceIdCandidate) {
      res.status(403).json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ" });
      return null;
    }

    if (!(await ensureWorkspaceAccess(site.workspaceId))) {
      return null;
    }

    if (site.publicApiKey !== apiKey) {
      res.status(401).json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ API-РєР»СЋС‡" });
      return null;
    }

    return { site, apiKey, workspaceId: site.workspaceId };
  }

  console.log(`[RAG DEBUG] public site not found, checking embed key context`);
  const embedKey = await storage.getWorkspaceEmbedKeyByPublicKey(apiKey);

  if (!embedKey) {
    res.status(404).json({ error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
    return null;
  }

  if (workspaceIdCandidate && workspaceIdCandidate !== embedKey.workspaceId) {
    res.status(403).json({ error: "РќРµС‚ РґРѕСЃС‚СѓРїР° Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ" });
    return null;
  }

  if (!(await ensureWorkspaceAccess(embedKey.workspaceId))) {
    return null;
  }

  const allowedDomains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id);
  const allowedDomainSet = new Set(
    allowedDomains
      .map((entry) => typeof entry.domain === "string" ? entry.domain.trim().toLowerCase() : "")
      .filter((domain) => domain.length > 0),
  );

  if (allowedDomainSet.size > 0) {
    if (!requestDomain) {
      res.status(403).json({ error: "Р”РѕРјРµРЅ Р·Р°РїСЂРѕСЃР° РЅРµ РѕРїСЂРµРґРµР»С‘РЅ. РџРµСЂРµРґР°Р№С‚Рµ Р·Р°РіРѕР»РѕРІРѕРє Origin РёР»Рё X-Embed-Origin." });
      return null;
    }

    if (!allowedDomainSet.has(requestDomain)) {
      res.status(403).json({ error: `Р”РѕРјРµРЅ ${requestDomain} РЅРµ РґРѕР±Р°РІР»РµРЅ РІ allowlist РґР»СЏ РґР°РЅРЅРѕРіРѕ РєР»СЋС‡Р°` });
      return null;
    }
  }

  return {
    apiKey,
    workspaceId: embedKey.workspaceId,
    embedKey,
    knowledgeBaseId: embedKey.knowledgeBaseId,
  };
}

async function resolveGenerativeWorkspace(
  req: Request,
  res: Response,
): Promise<{ workspaceId: string; site?: Site | null; isPublic: boolean } | null> {
  const bodySource: Record<string, unknown> =
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...(req.body as Record<string, unknown>) } : {};

  const headerKey = req.headers["x-api-key"];
  const apiKey = pickFirstString(
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    bodySource.apiKey,
    req.query.apiKey,
    req.query.apikey,
  );

  if (!apiKey) {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      return { workspaceId, site: null, isPublic: false };
    } catch (error) {
      if (error instanceof WorkspaceContextError) {
        res.status(401).json({ error: "РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ" });
        return null;
      }
      throw error;
    }
  }

  const publicContext = await resolvePublicCollectionRequest(req, res);
  if (!publicContext) {
    return null;
  }

  return { workspaceId: publicContext.workspaceId, site: publicContext.site ?? null, isPublic: true };
}

class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function handleKnowledgeBaseRouteError(error: unknown, res: Response) {
  if (error instanceof KnowledgeBaseError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error instanceof WorkspaceContextError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error("Knowledge base request failed", error);
  return res
    .status(500)
    .json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ Р·Р°РїСЂРѕСЃ Рє Р±Р°Р·Рµ Р·РЅР°РЅРёР№" });
}

function parseKnowledgeNodeParentId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  if (typeof raw !== "string") {
    throw new KnowledgeBaseError("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СЂРѕРґРёС‚РµР»СЏ", 400);
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function sanitizeRedirectPath(candidate: unknown): string {
  if (typeof candidate !== "string") {
    return "/";
  }

  const trimmed = candidate.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  try {
    const base = "http://localhost";
    const parsed = new URL(trimmed, base);
    if (parsed.origin !== base) {
      return "/";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function appendAuthErrorParam(path: string, code: string): string {
  const hashIndex = path.indexOf("#");
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";

  const questionIndex = base.indexOf("?");
  const pathname = questionIndex >= 0 ? base.slice(0, questionIndex) : base;
  const query = questionIndex >= 0 ? base.slice(questionIndex + 1) : "";

  const params = new URLSearchParams(query);
  params.set("authError", code);

  const queryString = params.toString();
  return `${pathname}${queryString ? `?${queryString}` : ""}${hash}`;
}

function parseVectorSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function resolveVectorSizeForCollection(
  provider: EmbeddingProvider,
  detectedVectorLength: number,
): number {
  const configuredSize = parseVectorSize(provider.qdrantConfig?.vectorSize);
  if (configuredSize) {
    return configuredSize;
  }

  if (detectedVectorLength > 0) {
    return detectedVectorLength;
  }

  if (provider.providerType === "gigachat") {
    return GIGACHAT_EMBEDDING_VECTOR_SIZE;
  }

  throw new Error(
    "РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ СЂР°Р·РјРµСЂ РІРµРєС‚РѕСЂР° РґР»СЏ РЅРѕРІРѕР№ РєРѕР»Р»РµРєС†РёРё. РЈРєР°Р¶РёС‚Рµ vectorSize РІ РЅР°СЃС‚СЂРѕР№РєР°С… СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ",
  );
}

async function ensureCollectionCreatedIfNeeded(options: {
  client: QdrantClient;
  provider: EmbeddingProvider;
  collectionName: string;
  detectedVectorLength: number;
  shouldCreateCollection: boolean;
  collectionExists: boolean;
}): Promise<boolean> {
  const {
    client,
    provider,
    collectionName,
    detectedVectorLength,
    shouldCreateCollection,
    collectionExists,
  } = options;

  if (collectionExists || !shouldCreateCollection) {
    return false;
  }

  const vectorSizeForCreation = resolveVectorSizeForCollection(
    provider,
    detectedVectorLength,
  );

  await client.createCollection(collectionName, {
    vectors: {
      size: vectorSizeForCreation,
      distance: "Cosine",
    },
  });

  return true;
}

function extractQdrantApiError(error: unknown):
  | {
      status: number;
      message: string;
      details: unknown;
    }
  | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    status?: unknown;
    statusText?: unknown;
    data?: unknown;
    message?: unknown;
  };

  if (typeof candidate.status !== "number") {
    return undefined;
  }

  if (typeof candidate.statusText !== "string" && typeof candidate.message !== "string") {
    return undefined;
  }

  const data = candidate.data;
  let message: string | undefined;

  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    const nestedError = dataRecord.error;
    const nestedStatus = dataRecord.status;
    const nestedMessage = dataRecord.message;

    if (typeof nestedError === "string" && nestedError.trim().length > 0) {
      message = nestedError;
    } else if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
      message = nestedMessage;
    } else if (typeof nestedStatus === "string" && nestedStatus.trim().length > 0) {
      message = nestedStatus;
    }
  }

  if (!message) {
    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      message = candidate.message;
    } else if (
      typeof candidate.statusText === "string" &&
      candidate.statusText.trim().length > 0
    ) {
      message = candidate.statusText;
    } else {
      message = "РћС€РёР±РєР° Qdrant";
    }
  }

  return {
    status: candidate.status,
    message,
    details: data ?? null,
  };
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | undefined {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: "РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ" });
    return undefined;
  }

  return user;
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return { firstName: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ", lastName: "" };
  }

  const [first, ...rest] = normalized.split(" ");
  return {
    firstName: first,
    lastName: rest.join(" ") ?? "",
  };
}

type PersonalApiTokenSummary = {
  id: string;
  lastFour: string;
  createdAt: string;
  revokedAt: string | null;
};

function toPersonalApiTokenSummary(token: PersonalApiToken): PersonalApiTokenSummary {
  const createdAt = token.createdAt instanceof Date ? token.createdAt.toISOString() : String(token.createdAt);
  const revokedAt = token.revokedAt
    ? token.revokedAt instanceof Date
      ? token.revokedAt.toISOString()
      : String(token.revokedAt)
    : null;

  return {
    id: token.id,
    lastFour: token.lastFour,
    createdAt,
    revokedAt,
  };
}

function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toWorkspaceMemberResponse(entry: WorkspaceMemberWithUser, currentUserId: string) {
  const { member, user } = entry;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: member.role,
    createdAt: toIsoDate(member.createdAt),
    updatedAt: toIsoDate(member.updatedAt),
    isYou: user.id === currentUserId,
  };
}

async function loadTokensAndSyncUser(userId: string): Promise<{
  tokens: PersonalApiToken[];
  activeTokens: PersonalApiToken[];
  latestActive: PersonalApiToken | null;
}> {
  const tokens = await storage.listUserPersonalApiTokens(userId);
  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const latestActive = activeTokens.length > 0 ? activeTokens[0]! : null;

  if (latestActive) {
    await storage.setUserPersonalApiToken(userId, {
      hash: latestActive.tokenHash,
      lastFour: latestActive.lastFour,
      generatedAt: latestActive.createdAt,
    });
  } else {
    await storage.setUserPersonalApiToken(userId, {
      hash: null,
      lastFour: null,
      generatedAt: null,
    });
  }

  return { tokens, activeTokens, latestActive };
}

function toPublicEmbeddingProvider(provider: EmbeddingProvider): PublicEmbeddingProvider {
  const { authorizationKey, ...rest } = provider;
  let qdrantConfig =
    rest.qdrantConfig && typeof rest.qdrantConfig === "object"
      ? { ...rest.qdrantConfig }
      : undefined;

  if (rest.providerType === "gigachat") {
    const baseConfig = qdrantConfig ?? { ...DEFAULT_QDRANT_CONFIG };
    const normalizedSize = parseVectorSize(baseConfig.vectorSize);

    qdrantConfig = {
      ...baseConfig,
      vectorSize: normalizedSize ?? GIGACHAT_EMBEDDING_VECTOR_SIZE,
    };
  }

  return {
    ...rest,
    qdrantConfig: qdrantConfig ?? rest.qdrantConfig,
    hasAuthorizationKey: Boolean(authorizationKey && authorizationKey.length > 0),
  };
}

function sanitizeLlmModelOptions(models: unknown): LlmModelOption[] {
  if (!Array.isArray(models)) {
    return [];
  }

  const sanitized: LlmModelOption[] = [];

  for (const entry of models) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const value = typeof raw.value === "string" ? raw.value.trim() : "";

    if (label.length === 0 || value.length === 0) {
      continue;
    }

    sanitized.push({ label, value });
  }

  return sanitized;
}

function toPublicLlmProvider(provider: LlmProvider): PublicLlmProvider {
  const { authorizationKey, availableModels, ...rest } = provider;
  const rawRequestConfig =
    rest.requestConfig && typeof rest.requestConfig === "object"
      ? (rest.requestConfig as Record<string, unknown>)
      : undefined;
  const rawResponseConfig =
    rest.responseConfig && typeof rest.responseConfig === "object"
      ? (rest.responseConfig as Record<string, unknown>)
      : undefined;

  const requestConfig = {
    ...DEFAULT_LLM_REQUEST_CONFIG,
    ...(rawRequestConfig ?? {}),
  };

  const responseConfig = {
    ...DEFAULT_LLM_RESPONSE_CONFIG,
    ...(rawResponseConfig ?? {}),
  };

  return {
    ...rest,
    requestConfig,
    responseConfig,
    hasAuthorizationKey: Boolean(authorizationKey && authorizationKey.length > 0),
    availableModels: sanitizeLlmModelOptions(availableModels),
  };
}

type NodeFetchOptions = FetchRequestInit & { agent?: HttpsAgent };

const insecureTlsAgent = new HttpsAgent({ rejectUnauthorized: false });

function applyTlsPreferences<T extends NodeFetchOptions>(
  options: T,
  allowSelfSignedCertificate: boolean,
): T {
  if (!allowSelfSignedCertificate) {
    return options;
  }

  return {
    ...options,
    agent: insecureTlsAgent,
  };
}


const sendJsonToWebhookSchema = z.object({
  webhookUrl: z.string().trim().url("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ URL"),
  payload: z.string().min(1, "JSON РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј")
});


const distanceEnum = z.enum(["Cosine", "Euclid", "Dot", "Manhattan"]);

const sparseVectorSchema = z.object({
  indices: z.array(z.number()),
  values: z.array(z.number()),
});

const pointVectorSchema = z.union([
  z.array(z.number()),
  z.array(z.array(z.number())),
  z.record(z.any()),
  sparseVectorSchema,
]);

const namedVectorSchema = z.object({
  name: z.string(),
  vector: z.array(z.number()),
});

const namedSparseVectorSchema = z.object({
  name: z.string(),
  vector: sparseVectorSchema,
});

const searchVectorSchema = z.union([
  z.array(z.number()),
  namedVectorSchema,
  namedSparseVectorSchema,
]);

const createVectorCollectionSchema = z.object({
  name: z.string().min(1).max(128),
  vectorSize: z.number().int().positive(),
  distance: distanceEnum.default("Cosine"),
  onDiskPayload: z.boolean().optional(),
});

const testEmbeddingCredentialsSchema = z.object({
  tokenUrl: z.string().trim().url("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ URL РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°"),
  embeddingsUrl: z.string().trim().url("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ URL СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ"),
  authorizationKey: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ Authorization key"),
  scope: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ OAuth scope"),
  model: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РјРѕРґРµР»СЊ СЌРјР±РµРґРґРёРЅРіРѕРІ"),
  allowSelfSignedCertificate: z.boolean().default(false),
  requestHeaders: z.record(z.string()).default({}),
});

const TEST_EMBEDDING_TEXT = "РїСЂРёРІРµС‚!";
const KNOWLEDGE_DOCUMENT_PAYLOAD_TEXT_LIMIT = 4000;
const KNOWLEDGE_DOCUMENT_PAYLOAD_HTML_LIMIT = 6000;

function parseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createEmbeddingRequestBody(model: string, sampleText: string): Record<string, unknown> {
  return {
    model,
    input: [sampleText],
    encoding_format: "float",
  };
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }

    return Math.round(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  return null;
}

function extractEmbeddingTokenLimit(provider: EmbeddingProvider): number | null {
  const limitKeys = ["max_tokens_per_vectorization", "maxTokensPerVectorization"];

  const getFromRecord = (record: Record<string, unknown> | null | undefined): number | null => {
    if (!record) {
      return null;
    }

    for (const key of limitKeys) {
      if (key in record) {
        const parsed = parsePositiveInteger(record[key]);
        if (parsed !== null) {
          return parsed;
        }

        const raw = record[key];
        if (raw === 0 || raw === "0") {
          return null;
        }
      }
    }

    return null;
  };

  const providerRecord = provider as Record<string, unknown>;
  const directLimit = getFromRecord(providerRecord);
  if (directLimit !== null) {
    return directLimit;
  }

  const requestConfig =
    provider.requestConfig && typeof provider.requestConfig === "object"
      ? (provider.requestConfig as Record<string, unknown>)
      : null;

  const configLimit = getFromRecord(requestConfig);
  if (configLimit !== null) {
    return configLimit;
  }

  const additionalFields =
    requestConfig && typeof requestConfig.additionalBodyFields === "object"
      ? (requestConfig.additionalBodyFields as Record<string, unknown>)
      : null;

  return getFromRecord(additionalFields);
}

function ensureNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers: number[] = [];

  for (const item of value) {
    if (typeof item !== "number" || Number.isNaN(item)) {
      return undefined;
    }

    numbers.push(item);
  }

  return numbers;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function createDeterministicUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest();
  const bytes = hash.subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizePointId(candidate: string | number): string | number {
  if (typeof candidate === "number") {
    return candidate;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return createDeterministicUuid("empty");
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (isUuid(trimmed)) {
    return trimmed;
  }

  return createDeterministicUuid(trimmed);
}

function normalizeDocumentText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countPlainTextWords(text: string): number {
  if (!text) {
    return 0;
  }

  return text.split(/\s+/).filter(Boolean).length;
}

function buildDocumentExcerpt(text: string, maxLength = 200): string {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}вЂ¦`;
}

function truncatePayloadValue(value: unknown, limit: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (limit <= 0 || trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, limit - 1)).trim()}вЂ¦`;
}

interface KnowledgeDocumentChunk {
  id?: string;
  content: string;
  index: number;
  start: number;
  end: number;
  charCount: number;
  wordCount: number;
  tokenCount: number;
  excerpt: string;
  vectorRecordId?: string | null;
}

function createKnowledgeDocumentChunks(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): KnowledgeDocumentChunk[] {
  const normalizedText = normalizeDocumentText(text);
  if (!normalizedText) {
    return [];
  }

  const effectiveSize = Math.max(1, chunkSize);
  const effectiveOverlap = Math.max(0, Math.min(chunkOverlap, effectiveSize - 1));
  const step = Math.max(1, effectiveSize - effectiveOverlap);
  const totalLength = normalizedText.length;
  const chunks: KnowledgeDocumentChunk[] = [];

  for (let start = 0, index = 0; start < totalLength; start += step, index += 1) {
    const end = Math.min(start + effectiveSize, totalLength);
    const slice = normalizedText.slice(start, end);
    const trimmed = slice.trim();

    if (!trimmed) {
      if (end >= totalLength) {
        break;
      }
      continue;
    }

    const charCount = trimmed.length;
    const wordCount = countPlainTextWords(trimmed);
    const tokenCount = wordCount;
    const excerpt = buildDocumentExcerpt(trimmed);

    chunks.push({
      id: `chunk-${index + 1}`,
      content: trimmed,
      index,
      start,
      end,
      charCount,
      wordCount,
      tokenCount,
      excerpt,
    });

    if (end >= totalLength) {
      break;
    }
  }

  return chunks;
}

function extractEmbeddingResponse(parsedBody: unknown) {
  if (!parsedBody || typeof parsedBody !== "object") {
    throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·РѕР±СЂР°С‚СЊ РѕС‚РІРµС‚ СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ");
  }

  const body = parsedBody as Record<string, unknown>;
  const data = body.data;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РІРµСЂРЅСѓР» РґР°РЅРЅС‹Рµ");
  }

  const firstEntry = data[0];
  if (!firstEntry || typeof firstEntry !== "object") {
    throw new Error("РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РѕС‚РІРµС‚");
  }

  const entryRecord = firstEntry as Record<string, unknown>;
  const vectorCandidate = entryRecord.embedding ?? entryRecord.vector;
  const vector = ensureNumberArray(vectorCandidate);

  if (!vector || vector.length === 0) {
    throw new Error("РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РІРµСЂРЅСѓР» С‡РёСЃР»РѕРІРѕР№ РІРµРєС‚РѕСЂ");
  }

  let usageTokens: number | undefined;
  const usage = body.usage as Record<string, unknown> | undefined;
  const usageValue = usage?.total_tokens;

  if (typeof usageValue === "number" && Number.isFinite(usageValue)) {
    usageTokens = usageValue;
  } else if (typeof usageValue === "string" && usageValue.trim()) {
    const parsedNumber = Number.parseFloat(usageValue);
    if (!Number.isNaN(parsedNumber)) {
      usageTokens = parsedNumber;
    }
  }

  let embeddingId: string | number | undefined;
  if (typeof entryRecord.id === "string" || typeof entryRecord.id === "number") {
    embeddingId = entryRecord.id;
  }

  return { vector, usageTokens, embeddingId };
}

function sanitizeCollectionName(source: string): string {
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
}

function buildWorkspaceScopedCollectionName(workspaceId: string, projectId: string, collectionId: string): string {
  const workspaceSlug = sanitizeCollectionName(workspaceId);
  const projectSlug = sanitizeCollectionName(projectId);
  const collectionSlug = sanitizeCollectionName(collectionId);
  return `ws_${workspaceSlug}__proj_${projectSlug}__coll_${collectionSlug}`;
}

function buildCollectionName(site: Site | undefined, provider: EmbeddingProvider, workspaceId: string): string {
  const projectId = site?.id ?? provider.id;
  return buildWorkspaceScopedCollectionName(workspaceId, projectId, provider.id);
}

function buildKnowledgeCollectionName(
  base: { id?: string | null; name?: string | null } | null | undefined,
  provider: EmbeddingProvider,
  workspaceId: string,
): string {
  const source = base?.id ?? base?.name ?? provider.id;
  return buildWorkspaceScopedCollectionName(workspaceId, source, provider.id);
}

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, current]) => current !== undefined)
      .map(([key, current]) => [key, removeUndefinedDeep(current)]);
    return Object.fromEntries(entries) as unknown as T;
  }

  return value;
}

function sanitizeHeadersForLog(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().includes("authorization")) {
      sanitized[key] = "***";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function buildVectorPayload(
  vector: number[],
  vectorFieldName: string | null | undefined,
): Schemas["NamedVectorStruct"] | number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    return vector;
  }

  const sanitizedVector = vector.map((entry, index) => {
    if (typeof entry !== "number" || Number.isNaN(entry)) {
      throw new Error(`РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ РєРѕРјРїРѕРЅРµРЅС‚С‹ РІРµРєС‚РѕСЂР° (index=${index})`);
    }

    if (!Number.isFinite(entry)) {
      throw new Error(`РљРѕРјРїРѕРЅРµРЅС‚Р° РІРµРєС‚РѕСЂР° СЃРѕРґРµСЂР¶РёС‚ Р±РµСЃРєРѕРЅРµС‡РЅРѕСЃС‚СЊ (index=${index})`);
    }

    return entry;
  });

  if (vectorFieldName && typeof vectorFieldName === "string") {
    const trimmed = vectorFieldName.trim();
    if (trimmed.length > 0) {
      return { name: trimmed, vector: sanitizedVector };
    }
  }

  return sanitizedVector;
}

function cloneVectorPayload(vector: unknown): unknown {
  if (Array.isArray(vector)) {
    return vector.slice();
  }

  if (vector && typeof vector === "object") {
    const record = vector as Record<string, unknown>;
    const vectorCopy = Array.isArray(record.vector) ? record.vector.slice() : null;
    const vectorName =
      typeof record.name === "string" && record.name.trim().length > 0 ? record.name.trim() : null;
    if (vectorCopy && vectorName) {
      return {
        ...record,
        name: vectorName,
        vector: vectorCopy,
      } satisfies Schemas["NamedVectorStruct"];
    }
  }

  return vector;
}

function normalizeBaseUrl(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    console.warn(
      `[public-api] РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ Р±Р°Р·РѕРІС‹Р№ URL РїСѓР±Р»РёС‡РЅРѕРіРѕ API: ${trimmed}. ${getErrorDetails(error)}`,
    );
    return null;
  }
}

function resolvePublicApiBaseUrl(req: Request): string {
  const candidates = [process.env.PUBLIC_API_BASE_URL, process.env.PUBLIC_RAG_API_BASE_URL];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocolCandidate =
    typeof forwardedProto === "string" && forwardedProto.trim().length > 0
      ? forwardedProto.split(",")[0]?.trim()
      : req.protocol;
  const protocol = protocolCandidate && protocolCandidate.length > 0 ? protocolCandidate : "http";
  const host = req.get("host");

  if (!host) {
    throw new Error(
      "РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ Р±Р°Р·РѕРІС‹Р№ URL РїСѓР±Р»РёС‡РЅРѕРіРѕ API. РЈРєР°Р¶РёС‚Рµ PUBLIC_API_BASE_URL РІ РїРµСЂРµРјРµРЅРЅС‹С… РѕРєСЂСѓР¶РµРЅРёСЏ.",
    );
  }

  const parsed = new URL(`${protocol}://${host}`);
  return parsed.toString().replace(/\/$/, "");
}

function normalizeVectorScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function buildCustomPayloadFromSchema(
  fields: CollectionSchemaFieldInput[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    try {
      const rendered = renderLiquidTemplate(field.template ?? "", context);
      const typedValue = castValueToType(rendered, field.type);
      acc[field.name] = normalizeArrayValue(typedValue, field.isArray);
    } catch (error) {
      console.error(`РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РїРѕР»Рµ СЃС…РµРјС‹ "${field.name}"`, error);
      acc[field.name] = null;
    }

    return acc;
  }, {});
}

interface ApiRequestLog {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

interface EmbeddingVectorResult {
  vector: number[];
  usageTokens?: number;
  embeddingId?: string | number;
  rawResponse: unknown;
  request: ApiRequestLog;
}

type OAuthProviderConfig = Pick<
  EmbeddingProvider | LlmProvider,
  "tokenUrl" | "authorizationKey" | "scope" | "requestHeaders" | "allowSelfSignedCertificate"
>;

async function fetchAccessToken(provider: OAuthProviderConfig): Promise<string> {
  const tokenHeaders = new Headers();
  const rawAuthorizationKey = provider.authorizationKey.trim();
  const hasAuthScheme = /^(?:[A-Za-z]+)\s+\S+/.test(rawAuthorizationKey);
  const authorizationHeader = hasAuthScheme
    ? rawAuthorizationKey
    : `Basic ${rawAuthorizationKey}`;

  tokenHeaders.set("Authorization", authorizationHeader);
  tokenHeaders.set("Content-Type", "application/x-www-form-urlencoded");
  tokenHeaders.set("Accept", "application/json");

  if (!tokenHeaders.has("RqUID")) {
    tokenHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    tokenHeaders.set(key, value);
  }

  const tokenRequestBody = new URLSearchParams({
    scope: provider.scope,
    grant_type: "client_credentials",
  }).toString();

  let tokenResponse: FetchResponse;

  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: "POST",
        headers: tokenHeaders,
        body: tokenRequestBody,
      },
      provider.allowSelfSignedCertificate,
    );

    tokenResponse = await fetch(provider.tokenUrl, requestOptions);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      !provider.allowSelfSignedCertificate &&
      errorMessage.toLowerCase().includes("self-signed certificate")
    ) {
      throw new Error(
        "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ Рє СЃРµСЂРІРёСЃСѓ: СЃРµСЂС‚РёС„РёРєР°С‚ РЅРµ РїСЂРѕС€С‘Р» РїСЂРѕРІРµСЂРєСѓ. Р’РєР»СЋС‡РёС‚Рµ РґРѕРІРµСЂРёРµ СЃР°РјРѕРїРѕРґРїРёСЃР°РЅРЅС‹Рј СЃРµСЂС‚РёС„РёРєР°С‚Р°Рј Рё РїРѕРІС‚РѕСЂРёС‚Рµ РїРѕРїС‹С‚РєСѓ.",
      );
    }

    throw new Error(`РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ Р·Р°РїСЂРѕСЃ РґР»СЏ РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°: ${errorMessage}`);
  }

  const rawBody = await tokenResponse.text();
  const parsedBody = parseJson(rawBody);

  if (!tokenResponse.ok) {
    let message = `РЎРµСЂРІРёСЃ РІРµСЂРЅСѓР» СЃС‚Р°С‚СѓСЃ ${tokenResponse.status}`;

    if (parsedBody && typeof parsedBody === "object") {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.error_description === "string") {
        message = body.error_description;
      } else if (typeof body.message === "string") {
        message = body.message;
      }
    } else if (typeof parsedBody === "string" && parsedBody.trim()) {
      message = parsedBody.trim();
    }

    throw new Error(`РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°: ${message}`);
  }

  if (parsedBody && typeof parsedBody === "object") {
    const body = parsedBody as Record<string, unknown>;
    const token = body.access_token;

    if (typeof token === "string" && token.trim()) {
      return token;
    }
  }

  throw new Error("РЎРµСЂРІРёСЃ РЅРµ РІРµСЂРЅСѓР» access_token");
}

async function fetchEmbeddingVector(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
  options?: { onBeforeRequest?: (details: ApiRequestLog) => void },
): Promise<EmbeddingVectorResult> {
  const embeddingHeaders = new Headers();
  embeddingHeaders.set("Content-Type", "application/json");
  embeddingHeaders.set("Accept", "application/json");

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    embeddingHeaders.set(key, value);
  }

  if (!embeddingHeaders.has("Authorization")) {
    embeddingHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const embeddingBody = createEmbeddingRequestBody(provider.model, text);
  const sanitizedHeaders = sanitizeHeadersForLog(embeddingHeaders);

  options?.onBeforeRequest?.({
    url: provider.embeddingsUrl,
    headers: sanitizedHeaders,
    body: embeddingBody,
  });

  let embeddingResponse: FetchResponse;

  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: "POST",
        headers: embeddingHeaders,
        body: JSON.stringify(embeddingBody),
      },
      provider.allowSelfSignedCertificate,
    );

    embeddingResponse = await fetch(provider.embeddingsUrl, requestOptions);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ Р·Р°РїСЂРѕСЃ Рє СЃРµСЂРІРёСЃСѓ СЌРјР±РµРґРґРёРЅРіРѕРІ: ${errorMessage}`);
  }

  const rawBody = await embeddingResponse.text();
  const parsedBody = parseJson(rawBody);

  if (!embeddingResponse.ok) {
    let message = `РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» СЃС‚Р°С‚СѓСЃ ${embeddingResponse.status}`;

    if (parsedBody && typeof parsedBody === "object") {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.error_description === "string") {
        message = body.error_description;
      } else if (typeof body.message === "string") {
        message = body.message;
      }
    } else if (typeof parsedBody === "string" && parsedBody.trim()) {
      message = parsedBody.trim();
    }

    throw new Error(`РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РїРѕР»СѓС‡РµРЅРёСЏ РІРµРєС‚РѕСЂР°: ${message}`);
  }

  const { vector, usageTokens, embeddingId } = extractEmbeddingResponse(parsedBody);

  return {
    vector,
    usageTokens,
    embeddingId,
    rawResponse: parsedBody,
    request: {
      url: provider.embeddingsUrl,
      headers: sanitizedHeaders,
      body: embeddingBody,
    },
  };
}

interface LlmCompletionResult {
  answer: string;
  usageTokens?: number | null;
  rawResponse: unknown;
  request: ApiRequestLog;
}

type LlmStreamEvent = {
  event: string;
  data: {
    text?: string;
    chunk?: unknown;
  };
};

type LlmCompletionPromise = Promise<LlmCompletionResult> & {
  streamIterator?: AsyncIterable<LlmStreamEvent>;
};

type GenerativeContextEntry = {
  id: string | number;
  payload: Record<string, unknown> | null;
  score?: number | null;
  shard_key?: unknown;
  order_value?: unknown;
};

type GigachatStreamOptions = {
  req: Request;
  res: Response;
  provider: LlmProvider;
  accessToken: string;
  query: string;
  context: LlmContextRecord[];
  sanitizedResults: GenerativeContextEntry[];
  embeddingResult: EmbeddingVectorResult;
  embeddingProvider: EmbeddingProvider;
  selectedModelValue?: string | null;
  selectedModelMeta: LlmModelOption | null;
  limit: number;
  contextLimit: number;
  responseFormat?: RagResponseFormat;
  includeContextInResponse: boolean;
  includeQueryVectorInResponse: boolean;
  collectionName: string;
};

function sendSseEvent(res: Response, eventName: string, data?: unknown) {
  const body =
    typeof data === "string" || data === undefined ? data ?? "" : JSON.stringify(data);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${body}\n\n`);

  const flusher = (res as Response & { flush?: () => void }).flush;
  if (typeof flusher === "function") {
    flusher.call(res);
  }
}

type AsyncStreamController<T> = {
  iterator: AsyncIterableIterator<T>;
  push: (value: T) => void;
  finish: () => void;
  fail: (error: unknown) => void;
};

function createAsyncStreamController<T>(): AsyncStreamController<T> {
  const queue: T[] = [];
  const pending: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  let done = false;
  let failed: unknown = null;

  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    next() {
      if (failed) {
        const error = failed;
        failed = null;
        return Promise.reject(error);
      }

      if (queue.length > 0) {
        const value = queue.shift()!;
        return Promise.resolve({ value, done: false });
      }

      if (done) {
        return Promise.resolve({ value: undefined as never, done: true });
      }

      return new Promise<IteratorResult<T>>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };

  const flushQueue = () => {
    while (queue.length > 0 && pending.length > 0) {
      const waiter = pending.shift()!;
      const value = queue.shift()!;
      waiter.resolve({ value, done: false });
    }
  };

  return {
    iterator,
    push(value: T) {
      if (done || failed) {
        return;
      }
      if (pending.length > 0) {
        const waiter = pending.shift()!;
        waiter.resolve({ value, done: false });
        return;
      }
      queue.push(value);
    },
    finish() {
      if (done || failed) {
        return;
      }
      done = true;
      flushQueue();
      while (pending.length > 0) {
        const waiter = pending.shift()!;
        waiter.resolve({ value: undefined as never, done: true });
      }
    },
    fail(error: unknown) {
      if (failed || done) {
        return;
      }
      failed = error ?? new Error("Stream interrupted");
      while (pending.length > 0) {
        const waiter = pending.shift()!;
        waiter.reject(failed);
      }
    },
  };
}

function extractTextDeltaFromChunk(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  const record = chunk as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const parts: string[] = [];

  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }

    const choiceRecord = choice as Record<string, unknown>;
    const delta = choiceRecord.delta;
    if (delta && typeof delta === "object") {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string") {
        parts.push(content);
      }
    }

    const text = choiceRecord.text;
    if (typeof text === "string") {
      parts.push(text);
    }

    const message = choiceRecord.message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") {
        parts.push(content);
      }
    }
  }

  return parts.join("");
}

function extractUsageTokensFromChunk(chunk: unknown): number | null {
  if (!chunk || typeof chunk !== "object") {
    return null;
  }

  const usage = (chunk as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const usageRecord = usage as Record<string, unknown>;
  if (typeof usageRecord.total_tokens === "number") {
    return usageRecord.total_tokens;
  }

  if (typeof usageRecord.completion_tokens === "number") {
    return usageRecord.completion_tokens;
  }

  return null;
}

async function streamGigachatCompletion(options: GigachatStreamOptions): Promise<void> {
  const {
    req,
    res,
    provider,
    accessToken,
    query,
    context,
    sanitizedResults,
    embeddingResult,
    embeddingProvider,
    selectedModelValue,
    selectedModelMeta,
    limit,
    contextLimit,
    responseFormat,
    includeContextInResponse,
    includeQueryVectorInResponse,
    collectionName,
  } = options;

  const streamHeaders = new Headers();
  streamHeaders.set("Content-Type", "application/json");
  streamHeaders.set("Accept", "text/event-stream");

  if (!streamHeaders.has("RqUID")) {
    streamHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    streamHeaders.set(key, value);
  }

  if (!streamHeaders.has("Authorization")) {
    streamHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const requestBody = buildLlmRequestBody(provider, query, context, selectedModelValue ?? undefined, {
    stream: true,
    responseFormat,
  });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const flushHeaders = (res as Response & { flushHeaders?: () => void }).flushHeaders;
  if (typeof flushHeaders === "function") {
    flushHeaders.call(res);
  }

  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  const metadataPayload: Record<string, unknown> = {
    usage: { embeddingTokens: embeddingResult.usageTokens ?? null },
    provider: {
      id: provider.id,
      name: provider.name,
      model: selectedModelValue ?? provider.model,
      modelLabel: selectedModelMeta?.label ?? selectedModelValue ?? provider.model,
    },
    embeddingProvider: {
      id: embeddingProvider.id,
      name: embeddingProvider.name,
    },
    limit,
    contextLimit,
    format: responseFormat ?? "text",
    collection: collectionName,
  };

  if (includeContextInResponse) {
    metadataPayload.context = sanitizedResults;
  }

  if (includeQueryVectorInResponse) {
    metadataPayload.queryVector = embeddingResult.vector;
    metadataPayload.vectorLength = embeddingResult.vector.length;
  }

  sendSseEvent(res, "status", { stage: "thinking", message: "Р”СѓРјР°СЋвЂ¦" });
  sendSseEvent(res, "status", { stage: "retrieving", message: "РС‰Сѓ РёСЃС‚РѕС‡РЅРёРєРёвЂ¦" });

  const streamedContextEntries = sanitizedResults.map((entry) => ({
    id: entry.id ?? null,
    score: typeof entry.score === "number" ? entry.score : null,
    payload: entry.payload ?? null,
    shard_key: entry.shard_key ?? null,
    order_value: entry.order_value ?? null,
  }));

  streamedContextEntries.slice(0, contextLimit).forEach((contextEntry, index) => {
    sendSseEvent(res, "source", { index: index + 1, context: contextEntry });
  });

  let completionResponse: FetchResponse;

  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: "POST",
        headers: streamHeaders,
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      },
      provider.allowSelfSignedCertificate,
    );

    completionResponse = await fetch(provider.completionUrl, requestOptions);
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    sendSseEvent(res, "error", {
      message: `РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ Р·Р°РїСЂРѕСЃ Рє LLM: ${errorMessage}`,
    });
    res.end();
    return;
  }

  if (!completionResponse.ok) {
    const rawBody = await completionResponse.text();
    let message = `LLM РІРµСЂРЅСѓР» СЃС‚Р°С‚СѓСЃ ${completionResponse.status}`;

    const parsedBody = parseJson(rawBody);
    if (parsedBody && typeof parsedBody === "object") {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.error_description === "string") {
        message = body.error_description;
      } else if (typeof body.message === "string") {
        message = body.message;
      }
    } else if (typeof parsedBody === "string" && parsedBody.trim()) {
      message = parsedBody.trim();
    }

    sendSseEvent(res, "error", { message: `РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РіРµРЅРµСЂР°С†РёРё РѕС‚РІРµС‚Р°: ${message}` });
    res.end();
    return;
  }

  if (!completionResponse.body) {
    sendSseEvent(res, "error", {
      message: "LLM РЅРµ РІРµСЂРЅСѓР» РїРѕС‚РѕРє РґР°РЅРЅС‹С…",
    });
    res.end();
    return;
  }

  sendSseEvent(res, "status", { stage: "answering", message: "Р¤РѕСЂРјСѓР»РёСЂСѓСЋ РѕС‚РІРµС‚вЂ¦" });

  const decoder = new TextDecoder();
  let buffer = "";
  let aggregatedAnswer = "";
  let llmUsageTokens: number | null = null;

  try {
    for await (const chunk of completionResponse.body as unknown as AsyncIterable<Uint8Array>) {
      if (abortController.signal.aborted) {
        return;
      }

      buffer += decoder.decode(chunk, { stream: true });

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex).replace(/\r/g, "");
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf("\n\n");

        if (!rawEvent.trim()) {
          continue;
        }

        const lines = rawEvent.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataPayload = dataLines.join("\n");
        if (!dataPayload) {
          continue;
        }

        if (dataPayload === "[DONE]") {
          sendSseEvent(res, "status", { stage: "done", message: "Р“РѕС‚РѕРІРѕ" });
          sendSseEvent(res, "done", {
            answer: aggregatedAnswer,
            usage: {
              embeddingTokens: embeddingResult.usageTokens ?? null,
              llmTokens: llmUsageTokens,
            },
            sourcesCount: streamedContextEntries.slice(0, contextLimit).length,
            metadata: metadataPayload,
            provider: metadataPayload.provider ?? null,
            embeddingProvider: metadataPayload.embeddingProvider ?? null,
            collection: collectionName,
            format: responseFormat ?? "text",
          });
          res.end();
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        const delta = extractTextDeltaFromChunk(parsed);
        if (delta) {
          aggregatedAnswer += delta;
          const normalizedEventName = eventName === "message" ? "delta" : eventName;
          sendSseEvent(res, normalizedEventName === "delta" ? "delta" : normalizedEventName, { text: delta });
        }

        const maybeUsage = extractUsageTokensFromChunk(parsed);
        if (typeof maybeUsage === "number") {
          llmUsageTokens = maybeUsage;
        }
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    sendSseEvent(res, "error", {
      message: `РћС€РёР±РєР° РїСЂРё С‡С‚РµРЅРёРё РїРѕС‚РѕРєР° LLM: ${errorMessage}`,
    });
    res.end();
    return;
  }

  sendSseEvent(res, "status", { stage: "done", message: "Р“РѕС‚РѕРІРѕ" });
  sendSseEvent(res, "done", {
    answer: aggregatedAnswer,
    usage: {
      embeddingTokens: embeddingResult.usageTokens ?? null,
      llmTokens: llmUsageTokens,
    },
    sourcesCount: streamedContextEntries.slice(0, contextLimit).length,
    metadata: metadataPayload,
    provider: metadataPayload.provider ?? null,
    embeddingProvider: metadataPayload.embeddingProvider ?? null,
    collection: collectionName,
    format: responseFormat ?? "text",
  });
  res.end();
}

function getValueByJsonPath(source: unknown, path: string): unknown {
  if (!path || typeof path !== "string") {
    return undefined;
  }

  const normalized = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let current: unknown = source;

  for (const segment of normalized) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function fetchLlmCompletion(
  provider: LlmProvider,
  accessToken: string,
  query: string,
  context: LlmContextRecord[],
  modelOverride?: string,
  options?: {
    stream?: boolean;
    responseFormat?: RagResponseFormat;
    onBeforeRequest?: (details: ApiRequestLog) => void;
  },
): LlmCompletionPromise {
  const shouldForceStream = options?.stream === true;
  const requestBody = buildLlmRequestBody(provider, query, context, modelOverride, {
    stream: shouldForceStream ? true : undefined,
    responseFormat: options?.responseFormat,
  });
  const llmHeaders = new Headers();
  llmHeaders.set("Content-Type", "application/json");
  const wantsStream = (requestBody as { stream?: unknown }).stream === true;
  llmHeaders.set("Accept", wantsStream ? "text/event-stream, application/json" : "application/json");

  if (!llmHeaders.has("RqUID")) {
    llmHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    llmHeaders.set(key, value);
  }

  if (!llmHeaders.has("Authorization")) {
    llmHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const streamController = wantsStream ? createAsyncStreamController<LlmStreamEvent>() : null;

  const completionPromise = (async () => {
    let completionResponse: FetchResponse;

    try {
      const requestOptions = applyTlsPreferences<NodeFetchOptions>(
        {
          method: "POST",
          headers: llmHeaders,
          body: JSON.stringify(requestBody),
        },
        provider.allowSelfSignedCertificate,
      );

      options?.onBeforeRequest?.({
        url: provider.completionUrl,
        headers: sanitizeHeadersForLog(llmHeaders),
        body: requestBody,
      });

      completionResponse = await fetch(provider.completionUrl, requestOptions);
    } catch (error) {
      streamController?.fail(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ Р·Р°РїСЂРѕСЃ Рє LLM: ${errorMessage}`);
    }

    if (!completionResponse.ok) {
      const rawBody = await completionResponse.text();
      const parsedBody = parseJson(rawBody);

      let message = `LLM РІРµСЂРЅСѓР» СЃС‚Р°С‚СѓСЃ ${completionResponse.status}`;

      if (parsedBody && typeof parsedBody === "object") {
        const body = parsedBody as Record<string, unknown>;
        if (typeof body.error_description === "string") {
          message = body.error_description;
        } else if (typeof body.message === "string") {
          message = body.message;
        }
      } else if (typeof parsedBody === "string" && parsedBody.trim()) {
        message = parsedBody.trim();
      }

      streamController?.fail(new Error(message));
      throw new Error(`РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РіРµРЅРµСЂР°С†РёРё РѕС‚РІРµС‚Р°: ${message}`);
    }

    const contentType = completionResponse.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("text/event-stream")) {
      if (!completionResponse.body) {
        streamController?.fail(new Error("LLM РЅРµ РІРµСЂРЅСѓР» РїРѕС‚РѕРє РґР°РЅРЅС‹С…"));
        throw new Error("LLM РЅРµ РІРµСЂРЅСѓР» РїРѕС‚РѕРє РґР°РЅРЅС‹С…");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      const rawEvents: unknown[] = [];
      let aggregatedAnswer = "";
      let usageTokens: number | null = null;
      let streamCompleted = false;

      try {
        for await (const chunk of completionResponse.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });

          let boundaryIndex = buffer.indexOf("\n\n");
          while (boundaryIndex >= 0) {
            const rawEvent = buffer.slice(0, boundaryIndex).replace(/\r/g, "");
            buffer = buffer.slice(boundaryIndex + 2);
            boundaryIndex = buffer.indexOf("\n\n");

            if (!rawEvent.trim()) {
              continue;
            }

            const lines = rawEvent.split("\n");
            let eventName = "message";
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim() || "message";
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              }
            }

            const dataPayload = dataLines.join("\n");
            if (!dataPayload) {
              continue;
            }

            if (dataPayload === "[DONE]") {
              streamCompleted = true;
              break;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(dataPayload);
            } catch {
              continue;
            }

            rawEvents.push(parsed);

            const delta = extractTextDeltaFromChunk(parsed);
            if (delta) {
              aggregatedAnswer += delta;
            }

            const normalizedEventName = eventName === "message" ? "delta" : eventName;
            if (streamController && (delta || parsed)) {
              streamController.push({
                event: normalizedEventName,
                data: {
                  text: delta || undefined,
                  chunk: parsed,
                },
              });
            }

            const maybeUsage = extractUsageTokensFromChunk(parsed);
            if (typeof maybeUsage === "number") {
              usageTokens = maybeUsage;
            }
          }

          if (streamCompleted) {
            break;
          }
        }
      } catch (error) {
        streamController?.fail(error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`РћС€РёР±РєР° РїСЂРё С‡С‚РµРЅРёРё SSE РѕС‚ LLM: ${errorMessage}`);
      }

      if (!aggregatedAnswer) {
        streamController?.finish();
        throw new Error("LLM РЅРµ РІРµСЂРЅСѓР» С‚РµРєСЃС‚ РѕС‚РІРµС‚Р°");
      }

      streamController?.finish();
      return {
        answer: aggregatedAnswer,
        usageTokens,
        rawResponse: rawEvents,
        request: {
          url: provider.completionUrl,
          headers: sanitizeHeadersForLog(llmHeaders),
          body: requestBody,
        },
      };
    }

    const rawBody = await completionResponse.text();
    const parsedBody = parseJson(rawBody);

    const responseConfig = mergeLlmResponseConfig(provider);
    const messageValue = getValueByJsonPath(parsedBody, responseConfig.messagePath);

    let answer: string | null = null;
    if (typeof messageValue === "string") {
      answer = messageValue.trim();
    } else if (Array.isArray(messageValue)) {
      answer = messageValue
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
            return (item as Record<string, unknown>).text as string;
          }
          return "";
        })
        .filter((part) => part.trim().length > 0)
        .join("\n");
      if (answer) {
        answer = answer.trim();
      }
    } else if (
      messageValue &&
      typeof messageValue === "object" &&
      typeof (messageValue as Record<string, unknown>).content === "string"
    ) {
      answer = ((messageValue as Record<string, unknown>).content as string).trim();
    }

    if (!answer) {
      throw new Error("LLM РЅРµ РІРµСЂРЅСѓР» С‚РµРєСЃС‚ РѕС‚РІРµС‚Р°");
    }

    let usageTokens: number | null = null;
    if (responseConfig.usageTokensPath) {
      const usageValue = getValueByJsonPath(parsedBody, responseConfig.usageTokensPath);
      if (typeof usageValue === "number" && Number.isFinite(usageValue)) {
        usageTokens = usageValue;
      } else if (typeof usageValue === "string" && usageValue.trim()) {
        const parsedNumber = Number.parseFloat(usageValue);
        if (!Number.isNaN(parsedNumber)) {
          usageTokens = parsedNumber;
        }
      }
    }

    streamController?.finish();
    return {
      answer,
      usageTokens,
      rawResponse: parsedBody,
      request: {
        url: provider.completionUrl,
        headers: sanitizeHeadersForLog(llmHeaders),
        body: requestBody,
      },
    };
  })();

  return Object.assign(completionPromise, {
    streamIterator: streamController?.iterator,
  });
}


const upsertPointsSchema = z.object({
  wait: z.boolean().optional(),
  ordering: z.enum(["weak", "medium", "strong"]).optional(),
  points: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    vector: pointVectorSchema,
    payload: z.record(z.any()).optional(),
  })).min(1),
});

const searchPointsSchema = z.object({
  vector: searchVectorSchema,
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal("majority"),
    z.literal("quorum"),
    z.literal("all"),
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const textSearchPointsSchema = z.object({
  query: z.string().trim().min(1, "Р’РІРµРґРёС‚Рµ РїРѕРёСЃРєРѕРІС‹Р№ Р·Р°РїСЂРѕСЃ"),
  embeddingProviderId: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ"),
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal("majority"),
    z.literal("quorum"),
    z.literal("all"),
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const generativeSearchPointsSchema = textSearchPointsSchema.extend({
  llmProviderId: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РїСЂРѕРІР°Р№РґРµСЂР° LLM"),
  llmModel: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РјРѕРґРµР»СЊ LLM").optional(),
  contextLimit: z.number().int().positive().max(50).optional(),
  responseFormat: z.string().optional(),
  includeContext: z.boolean().optional(),
  includeQueryVector: z.boolean().optional(),
  llmTemperature: z.coerce.number().min(0).max(2).optional(),
  llmMaxTokens: z.coerce.number().int().min(16).max(4_096).optional(),
  llmSystemPrompt: z.string().optional(),
  llmResponseFormat: z.string().optional(),
});

const publicVectorSearchSchema = searchPointsSchema.extend({
  collection: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РєРѕР»Р»РµРєС†РёСЋ Qdrant"),
});

const publicVectorizeSchema = z.object({
  text: z.string().trim().min(1, "РўРµРєСЃС‚ РґР»СЏ РІРµРєС‚РѕСЂРёР·Р°С†РёРё РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј"),
  embeddingProviderId: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ"),
  collection: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РєРѕР»Р»РµРєС†РёСЋ Qdrant").optional(),
});

const publicHybridBm25Schema = z
  .object({
    weight: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .optional()
  .default({});

const publicHybridVectorSchema = z
  .object({
    weight: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    collection: z.string().trim().min(1).optional(),
    embeddingProviderId: z.string().trim().min(1).optional(),
  })
  .optional()
  .default({});

const publicHybridConfigSchema = z
  .object({
    bm25: publicHybridBm25Schema,
    vector: publicHybridVectorSchema,
  })
  .default({ bm25: {}, vector: {} });

const publicGenerativeSearchSchema = generativeSearchPointsSchema.extend({
  collection: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РєРѕР»Р»РµРєС†РёСЋ Qdrant"),
  kbId: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ Р±Р°Р·Сѓ Р·РЅР°РЅРёР№").optional(),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  hybrid: publicHybridConfigSchema,
  llmTemperature: z.coerce.number().min(0).max(2).optional(),
  llmMaxTokens: z.coerce.number().int().min(16).max(4_096).optional(),
  llmSystemPrompt: z.string().optional(),
  llmResponseFormat: z.string().optional(),
});

const scrollCollectionSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
  offset: z.union([z.string(), z.number()]).optional(),
  filter: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  orderBy: z.unknown().optional(),
});

const vectorizeCollectionSchemaFieldSchema = z.object({
  name: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ РїРѕР»СЏ").max(120),
  type: z.enum(collectionFieldTypes),
  isArray: z.boolean().optional().default(false),
  template: z.string().default(""),
});

const vectorizeCollectionSchemaSchema = z.object({
  fields: z
    .array(vectorizeCollectionSchemaFieldSchema)
    .max(50, "РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ РїРѕР»РµР№ РІ СЃС…РµРјРµ"),
  embeddingFieldName: z.string().trim().min(1).max(120).optional().nullable(),
});

const knowledgeDocumentChunkConfigSchema = z
  .object({
    maxTokens: z.number().int().min(50).max(4_000).optional(),
    maxChars: z.number().int().min(200).max(20_000).optional(),
    overlapTokens: z.number().int().min(0).max(4_000).optional(),
    overlapChars: z.number().int().min(0).max(20_000).optional(),
    splitByPages: z.boolean().optional(),
    respectHeadings: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.maxTokens && !value.maxChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTokens"],
        message: "РЈРєР°Р¶РёС‚Рµ РѕРіСЂР°РЅРёС‡РµРЅРёРµ РїРѕ С‚РѕРєРµРЅР°Рј РёР»Рё СЃРёРјРІРѕР»Р°Рј",
      });
    }

    if (value.overlapTokens && value.maxTokens && value.overlapTokens >= value.maxTokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapTokens"],
        message: "РџРµСЂРµС…Р»С‘СЃС‚ РїРѕ С‚РѕРєРµРЅР°Рј РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РјРµРЅСЊС€Рµ Р»РёРјРёС‚Р°",
      });
    }

    if (value.overlapChars && value.maxChars && value.overlapChars >= value.maxChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapChars"],
        message: "РџРµСЂРµС…Р»С‘СЃС‚ РїРѕ СЃРёРјРІРѕР»Р°Рј РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РјРµРЅСЊС€Рµ Р»РёРјРёС‚Р°",
      });
    }
  });

const knowledgeDocumentChunkItemSchema = z.object({
  id: z.string().trim().min(1).optional(),
  index: z.coerce.number().int().min(0),
  text: z.string().trim().min(1, "Р§Р°РЅРє РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј"),
  charStart: z.coerce.number().int().min(0).optional(),
  charEnd: z.coerce.number().int().min(0).optional(),
  tokenCount: z.coerce.number().int().min(0).optional(),
  pageNumber: z.coerce.number().int().min(0).optional().nullable(),
  sectionPath: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
  contentHash: z.string().trim().optional(),
  vectorRecordId: z.union([z.string(), z.number()]).optional(),
});

const knowledgeDocumentChunksSchema = z.object({
  chunkSetId: z.string().trim().min(1).optional(),
  documentId: z.string().trim().min(1).optional(),
  versionId: z.string().trim().min(1).optional(),
  items: z.array(knowledgeDocumentChunkItemSchema).min(1),
  totalCount: z.coerce.number().int().min(0).optional(),
  config: knowledgeDocumentChunkConfigSchema.optional(),
});

const vectorizePageSchema = z.object({
  embeddingProviderId: z.string().uuid("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ"),
  collectionName: z
    .string()
    .trim()
    .min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ РєРѕР»Р»РµРєС†РёРё")
    .optional(),
  createCollection: z.boolean().optional(),
  schema: vectorizeCollectionSchemaSchema.optional(),
});

const vectorizeKnowledgeDocumentSchema = vectorizePageSchema.extend({
  document: z.object({
    id: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РґРѕРєСѓРјРµРЅС‚Р°"),
    title: z.string().optional().nullable(),
    text: z.string().trim().min(1, "Р”РѕРєСѓРјРµРЅС‚ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј"),
    html: z.string().optional().nullable(),
    path: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
    charCount: z.number().int().min(0).optional(),
    wordCount: z.number().int().min(0).optional(),
    excerpt: z.string().optional().nullable(),
    chunks: knowledgeDocumentChunksSchema.optional(),
  }),
  base: z
    .object({
      id: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ Р±РёР±Р»РёРѕС‚РµРєРё"),
      name: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  chunkSize: z.coerce.number().int().min(200).max(8000).default(800),
  chunkOverlap: z.coerce.number().int().min(0).max(4000).default(0),
});

type KnowledgeDocumentVectorizationJobInternal = KnowledgeDocumentVectorizationJobStatus & {
  workspaceId: string;
  result: KnowledgeDocumentVectorizationJobResult | null;
};

const knowledgeDocumentVectorizationJobs = new Map<string, KnowledgeDocumentVectorizationJobInternal>();
const knowledgeDocumentVectorizationJobCleanup = new Map<string, NodeJS.Timeout>();
const VECTORIZE_JOB_FAILURE_CLEANUP_DELAY_MS = 5_000;

function updateKnowledgeDocumentVectorizationJob(
  jobId: string,
  patch: Partial<KnowledgeDocumentVectorizationJobInternal>,
) {
  const current = knowledgeDocumentVectorizationJobs.get(jobId);
  if (!current) {
    return;
  }

  knowledgeDocumentVectorizationJobs.set(jobId, {
    ...current,
    ...patch,
  });
}

function scheduleKnowledgeDocumentVectorizationJobCleanup(jobId: string, delayMs = 60_000) {
  const existing = knowledgeDocumentVectorizationJobCleanup.get(jobId);
  if (existing) {
    clearTimeout(existing);
  }

  const timeout = setTimeout(() => {
    knowledgeDocumentVectorizationJobs.delete(jobId);
    knowledgeDocumentVectorizationJobCleanup.delete(jobId);
  }, delayMs);

  knowledgeDocumentVectorizationJobCleanup.set(jobId, timeout);
}

const fetchKnowledgeVectorRecordsSchema = z.object({
  collectionName: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РєРѕР»Р»РµРєС†РёСЋ"),
  recordIds: z
    .array(z.union([z.string().trim().min(1), z.number()]))
    .min(1, "РџРµСЂРµРґР°Р№С‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРёРЅ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ")
    .max(256, "Р—Р° РѕРґРёРЅ Р·Р°РїСЂРѕСЃ РјРѕР¶РЅРѕ РїРѕР»СѓС‡РёС‚СЊ РЅРµ Р±РѕР»РµРµ 256 Р·Р°РїРёСЃРµР№"),
  includeVector: z.boolean().optional(),
});

const knowledgeSuggestQuerySchema = z.object({
  q: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ Р·Р°РїСЂРѕСЃ"),
  kb_id: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ Р±Р°Р·Сѓ Р·РЅР°РЅРёР№"),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }

      const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
      if (!Number.isFinite(numeric)) {
        return undefined;
      }

      return numeric;
    }),
});

const knowledgeRagRequestSchema = z.object({
  q: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ Р·Р°РїСЂРѕСЃ"),
  kb_id: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ Р±Р°Р·Сѓ Р·РЅР°РЅРёР№"),
  top_k: z.coerce.number().int().min(1).max(20).default(6),
  skill_id: z.string().trim().optional(),
  hybrid: z
    .object({
      bm25: z
        .object({
          weight: z.coerce.number().min(0).max(1).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .default({}),
      vector: z
        .object({
          weight: z.coerce.number().min(0).max(1).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
          collection: z.string().trim().optional(),
          embedding_provider_id: z.string().trim().optional(),
        })
        .default({}),
    })
    .default({ bm25: {}, vector: {} }),
  llm: z.object({
    provider: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ РїСЂРѕРІР°Р№РґРµСЂР° LLM"),
    model: z.string().trim().optional(),
    temperature: z.coerce.number().min(0).max(2).optional(),
    max_tokens: z.coerce.number().int().min(16).max(4096).optional(),
    system_prompt: z.string().optional(),
    response_format: z.string().optional(),
  }),
  stream: z.boolean().optional(),
});

type KnowledgeRagRequest = z.infer<typeof knowledgeRagRequestSchema>;

interface KnowledgeBaseRagCombinedChunk {
  chunkId: string;
  documentId: string;
  docTitle: string;
  sectionTitle: string | null;
  text: string;
  snippet: string;
  bm25Score: number;
  vectorScore: number;
  bm25Normalized: number;
  vectorNormalized: number;
  combinedScore: number;
  nodeId: string | null;
  nodeSlug: string | null;
}

interface SanitizedVectorSearchResult {
  id: unknown;
  payload: Record<string, unknown> | null;
  score: number | null;
  shard_key: unknown;
  order_value: unknown;
}

interface KnowledgeBaseRagPipelineSuccess {
  response: {
    query: string;
    knowledgeBaseId: string;
    normalizedQuery: string;
    answer: string;
    citations: Array<{
      chunk_id: string;
      doc_id: string;
      doc_title: string;
      section_title: string | null;
      snippet: string;
      score: number;
      scores: { bm25: number; vector: number };
      node_id: string | null;
      node_slug: string | null;
    }>;
    chunks: Array<{
      chunk_id: string;
      doc_id: string;
      doc_title: string;
      section_title: string | null;
      snippet: string;
      text: string;
      score: number;
      scores: { bm25: number; vector: number };
      node_id: string | null;
      node_slug: string | null;
    }>;
    usage: { embeddingTokens: number | null; llmTokens: number | null };
    timings: {
      total_ms: number;
      retrieval_ms: number;
      bm25_ms: number;
      vector_ms: number;
      llm_ms: number;
    };
    debug: { vectorSearch: Array<Record<string, unknown>> | null };
    responseFormat: RagResponseFormat;
  };
  metadata: {
    pipelineLog: KnowledgeBaseAskAiPipelineStepLog[];
    workspaceId: string;
    embeddingProvider: EmbeddingProvider | null;
    embeddingResult: EmbeddingVectorResult | null;
    llmProvider: LlmProvider;
    llmModel: string | null;
    llmModelLabel: string | null;
    sanitizedVectorResults: SanitizedVectorSearchResult[];
    bm25Sections: Array<KnowledgeChunkSearchEntry>;
    bm25Weight: number;
    bm25Limit: number;
    vectorWeight: number;
    vectorLimit: number;
    vectorCollection: string | null;
    vectorResultCount: number | null;
    vectorDocumentCount: number | null;
    combinedResultCount: number | null;
    embeddingUsageTokens: number | null;
    llmUsageTokens: number | null;
    retrievalDuration: number | null;
    bm25Duration: number | null;
    vectorDuration: number | null;
    llmDuration: number | null;
    totalDuration: number | null;
    normalizedQuery: string;
    combinedResults: KnowledgeBaseRagCombinedChunk[];
  };
}

type KnowledgeBaseRagPipelineStream = {
  onEvent: (eventName: string, payload?: unknown) => void;
};

function forwardLlmStreamEvents(
  iterator: AsyncIterable<LlmStreamEvent>,
  emit: (eventName: string, payload?: unknown) => void,
) {
  return (async () => {
    const startTime = Date.now();
    let chunkCount = 0;
    let lastChunkTime = startTime;
    let firstChunkTime: number | null = null;

    for await (const entry of iterator) {
      chunkCount++;
      const currentTime = Date.now();
      
      if (firstChunkTime === null) {
        firstChunkTime = currentTime;
        const timeToFirstChunk = currentTime - startTime;
        console.log(`[RAG STREAM] First chunk received after ${timeToFirstChunk}ms`);
      }
      
      const timeSinceLastChunk = currentTime - lastChunkTime;
      lastChunkTime = currentTime;
      
      console.log(`[RAG STREAM] Chunk #${chunkCount} (О”${timeSinceLastChunk}ms):`, 
        JSON.stringify(entry.data).slice(0, 100));
      
      const eventName = entry.event || "delta";
      emit(eventName, entry.data);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[RAG STREAM] Stream completed: ${chunkCount} chunks in ${totalTime}ms`);
  })();
}

async function runKnowledgeBaseRagPipeline(options: {
  req: Request;
  body: KnowledgeRagRequest;
  stream?: KnowledgeBaseRagPipelineStream | null;
}): Promise<KnowledgeBaseRagPipelineSuccess> {
  const { req, body, stream } = options;
  const skillIdCandidate = typeof body.skill_id === "string" ? body.skill_id.trim() : "";
  const normalizedSkillId = skillIdCandidate.length > 0 ? skillIdCandidate : null;

  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const normalizeCollectionList = (list?: readonly string[] | null): string[] => {
    if (!list) {
      return [];
    }
    const unique = new Set<string>();
    for (const entry of list) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    }
    return Array.from(unique);
  };

  let effectiveTopK = body.top_k;
  let effectiveMinScore = 0;
  let effectiveMaxContextTokens: number | null = null;
  let allowSources = true;
  let skillCollectionFilter: string[] = [];

  const pipelineLog: KnowledgeBaseAskAiPipelineStepLog[] = [];
  const emitStreamEvent = (eventName: string, payload?: unknown) => {
    if (!stream?.onEvent) {
      return;
    }
    try {
      stream.onEvent(eventName, payload);
    } catch (eventError) {
      console.error(
        `[public/rag/answer] РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ СЃРѕР±С‹С‚РёРµ ${eventName}: ${getErrorDetails(eventError)}`,
      );
    }
  };
  const emitStreamStatus = (stage: string, message: string) => {
    emitStreamEvent("status", { stage, message });
  };
  const query = body.q.trim();
  const knowledgeBaseId = body.kb_id.trim();
  const wantsLlmStream = Boolean(stream);
  
  console.log(`[RAG PIPELINE] stream param:`, stream ? 'PROVIDED' : 'NULL');
  console.log(`[RAG PIPELINE] wantsLlmStream:`, wantsLlmStream);

  if (!query) {
    throw new HttpError(400, "РЈРєР°Р¶РёС‚Рµ РїРѕРёСЃРєРѕРІС‹Р№ Р·Р°РїСЂРѕСЃ");
  }

  emitStreamStatus("thinking", "РђРЅР°Р»РёР·РёСЂСѓСЋ Р·Р°РїСЂРѕСЃвЂ¦");
  const runStartedAt = new Date();
  let runStatus: "success" | "error" = "success";
  let runErrorMessage: string | null = null;
  let workspaceId: string | null = null;
  let normalizedQuery = query;

  let bm25Limit = body.hybrid.bm25.limit ?? effectiveTopK;
  let vectorLimit = body.hybrid.vector.limit ?? effectiveTopK;
  const recomputeLimits = () => {
    bm25Limit = body.hybrid.bm25.limit ?? effectiveTopK;
    vectorLimit = body.hybrid.vector.limit ?? effectiveTopK;
  };

  const requestedEmbeddingProviderId =
    typeof body.hybrid.vector.embedding_provider_id === "string"
      ? body.hybrid.vector.embedding_provider_id.trim()
      : "";
  const requestedVectorCollection =
    typeof body.hybrid.vector.collection === "string"
      ? body.hybrid.vector.collection.trim()
      : "";
  const bm25WeightOverride = body.hybrid.bm25.weight;
  const vectorWeightOverride = body.hybrid.vector.weight;
  const hasBm25WeightOverride = bm25WeightOverride !== undefined;
  const hasVectorWeightOverride = vectorWeightOverride !== undefined;

  let embeddingProviderId = requestedEmbeddingProviderId || null;
  let vectorCollection = requestedVectorCollection || null;
  let vectorConfigured = Boolean(embeddingProviderId && vectorCollection);

  let bm25Weight = hasBm25WeightOverride
    ? bm25WeightOverride!
    : vectorConfigured
      ? 0.5
      : 1;
  let vectorWeight = hasVectorWeightOverride
    ? vectorWeightOverride!
    : vectorConfigured
      ? 0.5
      : 0;

  let bm25Duration: number | null = null;
  let vectorDuration: number | null = null;
  let retrievalDuration: number | null = null;
  let llmDuration: number | null = null;
  let totalDuration: number | null = null;

  let embeddingUsageTokens: number | null = null;
  let llmUsageTokens: number | null = null;

  let bm25ResultCount: number | null = null;
  let vectorResultCount: number | null = null;
  let vectorDocumentCount: number | null = null;
  let combinedResultCount: number | null = null;

  let vectorSearchDetails: Array<Record<string, unknown>> | null = null;

  const vectorDocumentIds = new Set<string>();
  const vectorChunks: Array<{
    chunkId: string;
    score: number;
    recordId: string | null;
    payload: Record<string, unknown> | null;
  }> = [];
  const sanitizedVectorResults: SanitizedVectorSearchResult[] = [];
  let vectorCollectionsToSearch: string[] = [];

  let llmProviderId = body.llm.provider?.trim() || null;
  let llmModel = body.llm.model?.trim() || null;
  let llmModelLabel: string | null = null;

  let selectedEmbeddingProvider: EmbeddingProvider | null = null;
  let embeddingResultForMetadata: EmbeddingVectorResult | null = null;

  const startPipelineStep = (
    key: string,
    input: Record<string, unknown> | null,
    title: string,
  ) => {
    const step: KnowledgeBaseAskAiPipelineStepLog = {
      key,
      title,
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      input: input ? removeUndefinedDeep(input) : null,
      output: null,
      error: null,
    };
    pipelineLog.push(step);
    const startedAt = performance.now();
    return {
      setInput(nextInput?: Record<string, unknown> | null) {
        step.input = nextInput ? removeUndefinedDeep(nextInput) : null;
      },
      finish(output?: Record<string, unknown> | null) {
        step.finishedAt = new Date().toISOString();
        step.durationMs = Number((performance.now() - startedAt).toFixed(2));
        step.output = output ? removeUndefinedDeep(output) : null;
      },
      fail(error: unknown) {
        step.finishedAt = new Date().toISOString();
        step.durationMs = Number((performance.now() - startedAt).toFixed(2));
        step.status = "error";
        step.error = getErrorDetails(error);
      },
    };
  };

  const skipPipelineStep = (key: string, title: string, reason: string) => {
    pipelineLog.push({
      key,
      title,
      status: "skipped",
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      input: { reason },
      output: null,
      error: null,
    });
  };

  const finalizeRunLog = async () => {
    if (!workspaceId) {
      return;
    }

    const toNumber = (value: number | null) =>
      value === null ? null : Number(value.toFixed(2));
    const totalTokens =
      embeddingUsageTokens === null && llmUsageTokens === null
        ? null
        : (embeddingUsageTokens ?? 0) + (llmUsageTokens ?? 0);

    try {
      await storage.recordKnowledgeBaseAskAiRun({
        workspaceId,
        knowledgeBaseId,
        prompt: query,
        normalizedQuery,
        status: runStatus,
        errorMessage: runErrorMessage,
        topK: effectiveTopK ?? null,
        bm25Weight,
        bm25Limit,
        vectorWeight,
        vectorLimit: vectorConfigured ? vectorLimit : null,
        vectorCollection: vectorConfigured ? vectorCollection : null,
        embeddingProviderId: vectorConfigured ? embeddingProviderId : null,
        llmProviderId,
        llmModel,
        bm25ResultCount,
        vectorResultCount,
        vectorDocumentCount,
        combinedResultCount,
        embeddingTokens: embeddingUsageTokens,
        llmTokens: llmUsageTokens,
        totalTokens,
        retrievalDurationMs: toNumber(retrievalDuration),
        bm25DurationMs: toNumber(bm25Duration),
        vectorDurationMs: vectorResultCount !== null ? toNumber(vectorDuration) : null,
        llmDurationMs:
          llmUsageTokens !== null || (llmDuration !== null && llmDuration > 0)
            ? toNumber(llmDuration)
            : null,
        totalDurationMs: toNumber(totalDuration),
        startedAt: runStartedAt.toISOString(),
        pipelineLog,
      });
    } catch (logError) {
      console.error(
        `[public/rag/answer] РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ Р¶СѓСЂРЅР°Р» РІС‹РїРѕР»РЅРµРЅРёСЏ Ask AI: ${getErrorDetails(
          logError,
        )}`,
        { workspaceId, knowledgeBaseId },
      );
    }
  };

  try {
    const base = await storage.getKnowledgeBase(knowledgeBaseId);
    if (!base) {
      runStatus = "error";
      runErrorMessage = "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°";
      await finalizeRunLog();
      throw new HttpError(404, "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°");
    }

    workspaceId = base.workspaceId;

    if (normalizedSkillId) {
      const skill = await getSkillById(base.workspaceId, normalizedSkillId);
      if (!skill) {
        runStatus = "error";
        runErrorMessage = "пїЅ?пїЅпїЅпїЅ?пїЅ<пїЅпїЅ пїЅ?пїЅпїЅ пїЅ?пїЅпїЅпїЅпїЅпїЅ?пїЅпїЅ?";
        await finalizeRunLog();
        throw new HttpError(404, "пїЅ?пїЅпїЅпїЅ?пїЅ<пїЅпїЅ пїЅ?пїЅпїЅ пїЅ?пїЅпїЅпїЅпїЅпїЅ?пїЅпїЅ?");
      }

      effectiveTopK = skill.ragConfig.topK;
      effectiveMinScore = skill.ragConfig.minScore ?? 0;
      effectiveMaxContextTokens = skill.ragConfig.maxContextTokens ?? null;
      allowSources = skill.ragConfig.showSources;
      if (skill.ragConfig.mode === "selected_collections") {
        skillCollectionFilter = normalizeCollectionList(skill.ragConfig.collectionIds);
      } else {
        const workspaceCollections = await storage.listWorkspaceCollections(base.workspaceId);
        skillCollectionFilter = normalizeCollectionList(workspaceCollections);
      }
      recomputeLimits();

      console.log("[RAG PIPELINE] Skill config applied", {
        skillId: skill.id,
        topK: effectiveTopK,
        minScore: effectiveMinScore,
        maxContextTokens: effectiveMaxContextTokens,
        showSources: allowSources,
        mode: skill.ragConfig.mode,
        collections: skillCollectionFilter,
      });
    }

    vectorCollectionsToSearch =
      skillCollectionFilter.length > 0
        ? skillCollectionFilter
        : requestedVectorCollection
          ? [requestedVectorCollection]
          : [];
    // TODO: validate that selected collections belong to the current workspace/knowledge base.

    vectorCollection =
      vectorCollectionsToSearch.length > 0 ? vectorCollectionsToSearch.join(", ") : null;

    vectorConfigured = Boolean(vectorCollectionsToSearch.length > 0 && embeddingProviderId);
    if (vectorConfigured) {
      if (!hasVectorWeightOverride) {
        vectorWeight = 0.5;
      }
      if (!hasBm25WeightOverride) {
        bm25Weight = 0.5;
      }
    } else {
      vectorWeight = 0;
      if (bm25Weight <= 0) {
        bm25Weight = 1;
      }
    }

    if (vectorCollectionsToSearch.length > 0) {
      console.log("[RAG PIPELINE] Vector collections selected:", vectorCollectionsToSearch);
    }

    const weightSum = bm25Weight + vectorWeight;
    if (weightSum > 0) {
      bm25Weight /= weightSum;
      vectorWeight /= weightSum;
    } else {
      bm25Weight = 1;
      vectorWeight = 0;
    }

    const totalStart = performance.now();
    emitStreamStatus("retrieving", "РС‰Сѓ РёСЃС‚РѕС‡РЅРёРєРёвЂ¦");
    const retrievalStart = performance.now();
    const suggestionLimit = Math.max(bm25Limit, vectorLimit, effectiveTopK);

    type SuggestSections = Awaited<
      ReturnType<typeof storage.searchKnowledgeBaseSuggestions>
    >["sections"];
    let bm25Sections: SuggestSections = [];

    const bm25Step = startPipelineStep(
      "bm25_search",
      { limit: suggestionLimit, weight: bm25Weight },
      "BM25 РїРѕРёСЃРє",
    );
    const bm25Start = performance.now();
    try {
      const bm25Suggestions = await storage.searchKnowledgeBaseSuggestions(
        knowledgeBaseId,
        query,
        suggestionLimit,
      );
      bm25Duration = performance.now() - bm25Start;
      normalizedQuery = bm25Suggestions.normalizedQuery || query;
      bm25Sections = bm25Suggestions.sections
        .filter((entry) => entry.source === "content")
        .slice(0, bm25Limit);
      bm25ResultCount = bm25Sections.length;
      bm25Step.finish({
        normalizedQuery,
        candidates: bm25ResultCount,
      });
    } catch (error) {
      bm25Duration = performance.now() - bm25Start;
      bm25Step.fail(error);
      throw error;
    }

    if (vectorWeight > 0) {
      const vectorStep = startPipelineStep(
        "vector_search",
        {
          limit: vectorLimit,
          collection: vectorCollection,
          embeddingProviderId,
        },
        "Р’РµРєС‚РѕСЂРЅС‹Р№ РїРѕРёСЃРє",
      );
      const vectorStart = performance.now();
      try {
        const embeddingProvider = await storage.getEmbeddingProvider(
          embeddingProviderId!,
          workspaceId,
        );

        if (!embeddingProvider) {
          throw new HttpError(404, "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РЅР°Р№РґРµРЅ");
        }

        if (!embeddingProvider.isActive) {
          throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РѕС‚РєР»СЋС‡С‘РЅ");
        }

        embeddingProviderId = embeddingProvider.id;
        selectedEmbeddingProvider = embeddingProvider;

        const embeddingStep = startPipelineStep(
          "vector_embedding",
          {
            providerId: embeddingProvider.id,
            model: embeddingProvider.model,
            text: normalizedQuery,
          },
          "Р’РµРєС‚РѕСЂРёР·Р°С†РёСЏ Р·Р°РїСЂРѕСЃР°",
        );

        let embeddingResult: EmbeddingVectorResult;
        try {
          const embeddingAccessToken = await fetchAccessToken(embeddingProvider);
          embeddingResult = await fetchEmbeddingVector(
            embeddingProvider,
            embeddingAccessToken,
            normalizedQuery,
            {
              onBeforeRequest(details) {
                embeddingStep.setInput({
                  providerId: embeddingProvider.id,
                  model: embeddingProvider.model,
                  text: normalizedQuery,
                  request: details,
                });
              },
            },
          );
          embeddingUsageTokens = embeddingResult.usageTokens ?? null;
          embeddingResultForMetadata = embeddingResult;
          embeddingStep.finish({
            usageTokens: embeddingUsageTokens,
            embeddingId: embeddingResult.embeddingId ?? null,
            vectorDimensions: embeddingResult.vector.length,
            response: embeddingResult.rawResponse,
          });
        } catch (error) {
          embeddingUsageTokens = null;
          embeddingResultForMetadata = null;
          embeddingStep.fail(error);
          throw error;
        }

        if (!workspaceId) {
          throw new Error("???? ???????>?????? ???????????>??'?? ?????+?????? ?????????'?????????'???? ???>?? ?????+?>?????????? API ??????????");
        }

        const apiBaseUrl = resolvePublicApiBaseUrl(req);
        const requestUrl = new URL(
          "/api/public/collections/search/vector",
          `${apiBaseUrl}/`,
        ).toString();

        const vectorPayload = buildVectorPayload(
          embeddingResult.vector,
          embeddingProvider.qdrantConfig?.vectorFieldName,
        );

        let lastVectorResponseStatus = 200;

        for (const collectionName of vectorCollectionsToSearch) {
          const embedKey = await storage.getOrCreateWorkspaceEmbedKey(
            workspaceId,
            collectionName,
            knowledgeBaseId,
          );

          const vectorRequestPayload = removeUndefinedDeep({
            collection: collectionName,
            workspace_id: workspaceId,
            vector: cloneVectorPayload(vectorPayload),
            limit: vectorLimit,
            withPayload: true,
            withVector: false,
          });

          vectorStep.setInput({
            limit: vectorLimit,
            collections: vectorCollectionsToSearch,
            collection: collectionName,
            embeddingProviderId,
            request: {
              url: requestUrl,
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": "***",
              },
              payload: vectorRequestPayload,
            },
          });

          let vectorResponse: FetchResponse;
          try {
            vectorResponse = await fetch(requestUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": embedKey.publicKey,
              },
              body: JSON.stringify(vectorRequestPayload),
            });
          } catch (networkError) {
            throw new Error(
              "Vector search API request failed before reaching the workspace endpoint",
            );
          }

          lastVectorResponseStatus = vectorResponse.status;

          const rawVectorResponse = await vectorResponse.text();
          vectorDuration = performance.now() - vectorStart;
          const parsedVectorResponse = parseJson(rawVectorResponse);

          if (!vectorResponse.ok) {
            const errorMessage =
              parsedVectorResponse && typeof parsedVectorResponse === "object" &&
              typeof (parsedVectorResponse as Record<string, unknown>).error === "string"
                ? ((parsedVectorResponse as Record<string, unknown>).error as string)
                : "Workspace vector search API returned an error";
            throw new HttpError(vectorResponse.status, errorMessage, parsedVectorResponse);
          }

          if (
            !parsedVectorResponse ||
            typeof parsedVectorResponse !== "object" ||
            !Array.isArray((parsedVectorResponse as Record<string, unknown>).results)
          ) {
            throw new Error("Workspace vector search API returned a malformed response");
          }

          const vectorResults = (parsedVectorResponse as {
            results: Array<Record<string, unknown>>;
          }).results;

          const formattedResults = vectorResults.map((item) => ({
            collection: collectionName,
            id: item.id ?? null,
            score: normalizeVectorScore(item.score),
            payload: (item.payload as Record<string, unknown> | undefined) ?? null,
          }));

          vectorSearchDetails = [
            ...(vectorSearchDetails ?? []),
            ...formattedResults,
          ];

          sanitizedVectorResults.push(
            ...vectorResults.map((item) => ({
              id: item.id ?? null,
              payload: (item.payload as Record<string, unknown> | undefined) ?? null,
              score: normalizeVectorScore(item.score),
              shard_key: (item as Record<string, unknown>).shard_key ?? null,
              order_value: (item as Record<string, unknown>).order_value ?? null,
            })),
          );

          for (const item of vectorResults) {
            const payload = (item.payload as Record<string, unknown> | undefined) ?? null;
            const rawScore = normalizeVectorScore(item.score);

            vectorChunks.push({
              chunkId: typeof payload?.chunk_id === "string" ? payload.chunk_id : "",
              score: rawScore ?? 0,
              recordId: typeof item.id === "string" ? item.id : null,
              payload,
            });
          }
        }

        vectorResultCount = vectorChunks.length;
        vectorStep.finish({
          hits: vectorResultCount,
          usageTokens: embeddingUsageTokens,
          response: {
            status: lastVectorResponseStatus,
            collection: vectorCollection,
            collections: vectorCollectionsToSearch,
            results: vectorSearchDetails,
          },
        });
      } catch (error) {
        vectorDuration = performance.now() - vectorStart;
        vectorStep.fail(error);
        throw error;
      }
    } else {
      skipPipelineStep(
        "vector_embedding",
        "Р’РµРєС‚РѕСЂРёР·Р°С†РёСЏ Р·Р°РїСЂРѕСЃР°",
        "Р’РµРєС‚РѕСЂРЅС‹Р№ РїРѕРёСЃРє РѕС‚РєР»СЋС‡С‘РЅ",
      );
      skipPipelineStep("vector_search", "Р’РµРєС‚РѕСЂРЅС‹Р№ РїРѕРёСЃРє", "Р’РµРєС‚РѕСЂРЅС‹Р№ РїРѕРёСЃРє РѕС‚РєР»СЋС‡С‘РЅ");
    }

    const chunkDetailsFromVector = await storage.getKnowledgeChunksByIds(
      knowledgeBaseId,
      Array.from(new Set(vectorChunks.map((entry) => entry.chunkId).filter(Boolean))),
    );
    const vectorRecordIds = vectorChunks
      .map((entry) => entry.recordId)
      .filter((value): value is string => Boolean(value));
    const chunkDetailsFromRecords =
      vectorRecordIds.length > 0
        ? await storage.getKnowledgeChunksByVectorRecords(knowledgeBaseId, vectorRecordIds)
        : [];

    const chunkDetailsMap = new Map<
      string,
      {
        documentId: string;
        docTitle: string;
        sectionTitle: string | null;
        text: string;
        nodeId: string | null;
        nodeSlug: string | null;
      }
    >();
    const recordToChunk = new Map<string, string>();

    for (const detail of chunkDetailsFromVector) {
      chunkDetailsMap.set(detail.chunkId, {
        documentId: detail.documentId,
        docTitle: detail.docTitle,
        sectionTitle: detail.sectionTitle,
        text: detail.text,
        nodeId: detail.nodeId,
        nodeSlug: detail.nodeSlug,
      });
    }

    for (const detail of chunkDetailsFromRecords) {
      chunkDetailsMap.set(detail.chunkId, {
        documentId: detail.documentId,
        docTitle: detail.docTitle,
        sectionTitle: detail.sectionTitle,
        text: detail.text,
        nodeId: detail.nodeId,
        nodeSlug: detail.nodeSlug,
      });

      if (detail.vectorRecordId) {
        recordToChunk.set(detail.vectorRecordId, detail.chunkId);
      }
    }

    const aggregated = new Map<
      string,
      {
        chunkId: string;
        documentId: string;
        docTitle: string;
        sectionTitle: string | null;
        text: string;
        snippet: string;
        bm25Score: number;
        vectorScore: number;
        nodeId: string | null;
        nodeSlug: string | null;
      }
    >();

    const buildSnippet = (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length <= 320) {
        return trimmed;
      }
      return `${trimmed.slice(0, 320)}вЂ¦`;
    };

    for (const entry of bm25Sections) {
      const snippet = entry.snippet || buildSnippet(entry.text);
      aggregated.set(entry.chunkId, {
        chunkId: entry.chunkId,
        documentId: entry.documentId,
        docTitle: entry.docTitle,
        sectionTitle: entry.sectionTitle,
        text: entry.text,
        snippet,
        bm25Score: entry.score,
        vectorScore: 0,
        nodeId: entry.nodeId ?? null,
        nodeSlug: entry.nodeSlug ?? null,
      });
    }

    for (const entry of vectorChunks) {
      let chunkId = entry.chunkId;
      if (!chunkId && entry.recordId) {
        chunkId = recordToChunk.get(entry.recordId) ?? "";
      }

      if (!chunkId) {
        continue;
      }

      const detail = chunkDetailsMap.get(chunkId);
      if (!detail) {
        continue;
      }

      const existing = aggregated.get(chunkId);
      const baseSnippet =
        entry.payload && typeof entry.payload === "object"
          ? (() => {
              const chunkPayload = (entry.payload as { chunk?: { excerpt?: unknown } }).chunk;
              if (chunkPayload && typeof chunkPayload.excerpt === "string") {
                return chunkPayload.excerpt;
              }
              return null;
            })()
          : null;

      const snippet = baseSnippet ?? existing?.snippet ?? buildSnippet(detail.text);
      const nodeId = detail.nodeId ?? existing?.nodeId ?? null;
      const nodeSlug = detail.nodeSlug ?? existing?.nodeSlug ?? null;

      aggregated.set(chunkId, {
        chunkId,
        documentId: detail.documentId,
        docTitle: detail.docTitle,
        sectionTitle: detail.sectionTitle,
        text: detail.text,
        snippet,
        bm25Score: existing?.bm25Score ?? 0,
        vectorScore: Math.max(existing?.vectorScore ?? 0, entry.score),
        nodeId,
        nodeSlug,
      });

      vectorDocumentIds.add(detail.documentId);
    }

    const bm25Max = Math.max(...Array.from(aggregated.values()).map((item) => item.bm25Score), 0);
    const vectorMax = Math.max(...Array.from(aggregated.values()).map((item) => item.vectorScore), 0);

    const combinedStep = startPipelineStep(
      "combine_results",
      { topK: effectiveTopK, bm25Weight, vectorWeight },
      "Combining retrieval results",
    );

    let combinedResults = Array.from(aggregated.values())
      .map((item) => {
        const bm25Normalized = bm25Max > 0 ? item.bm25Score / bm25Max : 0;
        const vectorNormalized = vectorMax > 0 ? item.vectorScore / vectorMax : 0;
        const combinedScore = bm25Normalized * bm25Weight + vectorNormalized * vectorWeight;

        return {
          ...item,
          combinedScore,
          bm25Normalized,
          vectorNormalized,
        } satisfies KnowledgeBaseRagCombinedChunk;
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);

    const rawCombinedResults = combinedResults;

    if (effectiveMinScore > 0) {
      const filtered = combinedResults.filter((item) => item.combinedScore >= effectiveMinScore);
      if (filtered.length > 0) {
        combinedResults = filtered;
      }
    }

    combinedResults = combinedResults.slice(0, effectiveTopK);

    if (combinedResults.length === 0 && rawCombinedResults.length > 0) {
      combinedResults = rawCombinedResults.slice(0, Math.max(1, effectiveTopK));
    }

    if (effectiveMaxContextTokens && effectiveMaxContextTokens > 0 && combinedResults.length > 0) {
      const limited: typeof combinedResults = [];
      let usedTokens = 0;
      for (const item of combinedResults) {
        const tokens = estimateTokens(item.text);
        if (limited.length > 0 && usedTokens + tokens > effectiveMaxContextTokens) {
          break;
        }
        limited.push(item);
        usedTokens += tokens;
        if (usedTokens >= effectiveMaxContextTokens) {
          break;
        }
      }
      if (limited.length > 0) {
        combinedResults = limited;
      }
      console.log('[RAG PIPELINE] Applied maxContextTokens limit', {
        limit: effectiveMaxContextTokens,
        chunks: combinedResults.length,
      });
    }

    if (allowSources) {
      combinedResults.forEach((item, index) => {
        emitStreamEvent("source", {
          index: index + 1,
          context: {
            chunk_id: item.chunkId,
            doc_id: item.documentId,
            doc_title: item.docTitle,
            section_title: item.sectionTitle,
            snippet: item.snippet,
            score: item.combinedScore,
            scores: {
              bm25: item.bm25Score,
              vector: item.vectorScore,
              bm25_normalized: item.bm25Normalized,
              vector_normalized: item.vectorNormalized,
            },
            node_id: item.nodeId ?? null,
            node_slug: item.nodeSlug ?? null,
          },
        });
      });
    }

    combinedResultCount = combinedResults.length;
    vectorDocumentCount = vectorResultCount !== null ? vectorDocumentIds.size : null;
    combinedStep.finish({ combined: combinedResultCount, vectorDocuments: vectorDocumentCount });

    const contextRecords: LlmContextRecord[] = combinedResults.map((item, index) => ({
      index,
      score: item.combinedScore,
      payload: {
        chunk: {
          id: item.chunkId,
          text: item.text,
          snippet: item.snippet,
          sectionTitle: item.sectionTitle,
          nodeId: item.nodeId,
          nodeSlug: item.nodeSlug,
        },
        document: {
          id: item.documentId,
          title: item.docTitle,
          nodeId: item.nodeId,
          nodeSlug: item.nodeSlug,
        },
        scores: {
          bm25: item.bm25Score,
          vector: item.vectorScore,
          bm25Normalized: item.bm25Normalized,
          vectorNormalized: item.vectorNormalized,
        },
      },
    }));

    retrievalDuration = performance.now() - retrievalStart;

    const ragResponseFormat = normalizeResponseFormat(body.llm.response_format);
    if (ragResponseFormat === null) {
      runStatus = "error";
      runErrorMessage = "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ РѕС‚РІРµС‚Р°";
      await finalizeRunLog();
      throw new HttpError(400, "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ РѕС‚РІРµС‚Р°", {
        details: "РџРѕРґРґРµСЂР¶РёРІР°СЋС‚СЃСЏ Р·РЅР°С‡РµРЅРёСЏ text, md/markdown РёР»Рё html",
      });
    }
    const responseFormat: RagResponseFormat = ragResponseFormat ?? "text";

    const llmProvider = await storage.getLlmProvider(body.llm.provider, workspaceId);
    if (!llmProvider) {
      runStatus = "error";
      runErrorMessage = "РџСЂРѕРІР°Р№РґРµСЂ LLM РЅРµ РЅР°Р№РґРµРЅ";
      await finalizeRunLog();
      throw new HttpError(404, "РџСЂРѕРІР°Р№РґРµСЂ LLM РЅРµ РЅР°Р№РґРµРЅ");
    }

    if (!llmProvider.isActive) {
      throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ РїСЂРѕРІР°Р№РґРµСЂ LLM РѕС‚РєР»СЋС‡С‘РЅ");
    }

    const requestConfig = mergeLlmRequestConfig(llmProvider);

    if (body.llm.system_prompt !== undefined) {
      requestConfig.systemPrompt = body.llm.system_prompt || undefined;
    }

    if (body.llm.temperature !== undefined) {
      requestConfig.temperature = body.llm.temperature;
    }

    if (body.llm.max_tokens !== undefined) {
      requestConfig.maxTokens = body.llm.max_tokens;
    }

    const configuredProvider: LlmProvider = {
      ...llmProvider,
      requestConfig,
    };

    llmProviderId = llmProvider.id;

    const sanitizedModels = sanitizeLlmModelOptions(llmProvider.availableModels);
    const requestedModel = typeof body.llm.model === "string" ? body.llm.model.trim() : "";
    const normalizedModelFromList =
      sanitizedModels.find((model) => model.value === requestedModel)?.value ??
      sanitizedModels.find((model) => model.label === requestedModel)?.value ??
      null;
    const selectedModelValue =
      (normalizedModelFromList && normalizedModelFromList.trim().length > 0
        ? normalizedModelFromList.trim()
        : undefined) ??
      (requestedModel.length > 0 ? requestedModel : undefined) ??
      llmProvider.model;
    const selectedModelMeta =
      sanitizedModels.find((model) => model.value === selectedModelValue) ?? null;
    llmModel = selectedModelValue ?? null;
    llmModelLabel = selectedModelMeta?.label ?? selectedModelValue ?? null;

    emitStreamStatus("answering", "Р¤РѕСЂРјСѓР»РёСЂСѓСЋ РѕС‚РІРµС‚вЂ¦");
    const llmAccessToken = await fetchAccessToken(configuredProvider);
    const llmStep = startPipelineStep(
      "llm_completion",
      { providerId: llmProviderId, model: llmModel },
      "Р“РµРЅРµСЂР°С†РёСЏ РѕС‚РІРµС‚Р° LLM",
    );
    const llmStart = performance.now();
    let completion: LlmCompletionResult;
    const completionPromise = fetchLlmCompletion(
      configuredProvider,
      llmAccessToken,
      normalizedQuery,
      contextRecords,
      selectedModelValue,
      {
        stream: wantsLlmStream,
        responseFormat,
        onBeforeRequest(details) {
          llmStep.setInput({
            providerId: llmProviderId,
            model: llmModel,
            request: details,
          });
        },
      },
    );
    const llmStreamIterator = wantsLlmStream ? completionPromise.streamIterator : null;
    const llmStreamForwarder =
      wantsLlmStream && llmStreamIterator
        ? forwardLlmStreamEvents(llmStreamIterator, emitStreamEvent)
        : null;
    try {
      completion = await completionPromise;
      if (llmStreamForwarder) {
        await llmStreamForwarder;
      }
      llmDuration = performance.now() - llmStart;
      llmUsageTokens = completion.usageTokens ?? null;
      llmStep.finish({
        tokens: llmUsageTokens,
        response: completion.rawResponse,
        answerPreview: completion.answer.slice(0, 160),
      });
    } catch (error) {
      if (llmStreamForwarder) {
        try {
          await llmStreamForwarder;
        } catch (streamError) {
          console.error("РћС€РёР±РєР° РїРµСЂРµСЃС‹Р»РєРё РїРѕС‚РѕРєР° LLM:", getErrorDetails(streamError));
        }
      }
      llmDuration = performance.now() - llmStart;
      llmStep.fail(error);
      throw error;
    }

    totalDuration = performance.now() - totalStart;

    await storage.recordKnowledgeBaseRagRequest({
      workspaceId,
      knowledgeBaseId,
      topK: effectiveTopK ?? null,
      bm25Weight,
      bm25Limit,
      vectorWeight,
      vectorLimit: vectorConfigured ? vectorLimit : null,
      embeddingProviderId: vectorConfigured ? embeddingProviderId : null,
      collection: vectorConfigured ? vectorCollection : null,
    });

    const citations = allowSources
      ? combinedResults.map((item) => ({
          chunk_id: item.chunkId,
          doc_id: item.documentId,
          doc_title: item.docTitle,
          section_title: item.sectionTitle,
          snippet: item.snippet,
          score: item.combinedScore,
          scores: {
            bm25: item.bm25Score,
            vector: item.vectorScore,
          },
          node_id: item.nodeId ?? null,
          node_slug: item.nodeSlug ?? null,
        }))
      : [];

    const responseChunks = allowSources
      ? combinedResults.map((item) => ({
          chunk_id: item.chunkId,
          doc_id: item.documentId,
          doc_title: item.docTitle,
          section_title: item.sectionTitle,
          snippet: item.snippet,
          text: item.text,
          score: item.combinedScore,
          scores: {
            bm25: item.bm25Score,
            vector: item.vectorScore,
          },
          node_id: item.nodeId ?? null,
          node_slug: item.nodeSlug ?? null,
        }))
      : [];

    const response = {
      query,
      knowledgeBaseId,
      normalizedQuery,
      answer: completion.answer,
      citations,
      chunks: responseChunks,
      usage: {
        embeddingTokens: embeddingUsageTokens,
        llmTokens: llmUsageTokens,
      },
      timings: {
        total_ms: Number((totalDuration ?? 0).toFixed(2)),
        retrieval_ms: Number((retrievalDuration ?? 0).toFixed(2)),
        bm25_ms: Number((bm25Duration ?? 0).toFixed(2)),
        vector_ms: Number((vectorDuration ?? 0).toFixed(2)),
        llm_ms: Number((llmDuration ?? 0).toFixed(2)),
      },
      debug: {
        vectorSearch: vectorSearchDetails,
      },
      responseFormat,
    } as const;

    if (!wantsLlmStream) {
      emitStreamEvent("delta", { text: response.answer });
    }
    emitStreamStatus("done", "Р“РѕС‚РѕРІРѕ");
    emitStreamEvent("done", {
      answer: response.answer,
      query: response.query,
      kb_id: response.knowledgeBaseId,
      normalized_query: response.normalizedQuery,
      citations: response.citations,
      chunks: response.chunks,
      usage: response.usage,
      timings: response.timings,
      debug: response.debug,
      format: response.responseFormat,
    });

    await finalizeRunLog();

    return {
      response,
      metadata: {
        pipelineLog,
        workspaceId,
        embeddingProvider: selectedEmbeddingProvider,
        embeddingResult: embeddingResultForMetadata,
        llmProvider,
        llmModel,
        llmModelLabel,
        sanitizedVectorResults,
        bm25Sections,
        bm25Weight,
        bm25Limit,
        vectorWeight,
        vectorLimit,
        vectorCollection,
        vectorResultCount,
        vectorDocumentCount,
        combinedResultCount,
        embeddingUsageTokens,
        llmUsageTokens,
        retrievalDuration,
        bm25Duration,
        vectorDuration,
        llmDuration,
        totalDuration,
        normalizedQuery,
        combinedResults,
      },
    };
  } catch (error) {
    runStatus = "error";
    runErrorMessage = getErrorDetails(error);
    await finalizeRunLog();
    throw error;
  }
}

// Public search API request/response schemas

interface PublicSearchResponse {
  hits: Array<{
    objectID: string;
    url: string;
    title?: string;
    content?: string;
    hierarchy?: {
      lvl0?: string;
      lvl1?: string;
      lvl2?: string;
    };
    excerpt?: string;
    _highlightResult?: {
      title?: { value: string; matchLevel: string };
      content?: { value: string; matchLevel: string };
    };
  }>;
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  query: string;
  params: string;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightQuery(text: string, query: string): { value: string; matchLevel: "none" | "partial" | "full" } {
  if (!text.trim()) {
    return { value: text, matchLevel: "none" };
  }

  const terms = Array.from(new Set(query.split(/\s+/).filter(Boolean)));
  if (terms.length === 0) {
    return { value: text, matchLevel: "none" };
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  let hasMatch = false;
  const highlighted = text.replace(pattern, (match) => {
    hasMatch = true;
    return `<mark>${match}</mark>`;
  });

  return { value: highlighted, matchLevel: hasMatch ? "partial" : "none" };
}

function buildExcerpt(content: string | null | undefined, query: string, maxLength = 220): string | undefined {
  if (!content) {
    return undefined;
  }

  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  const lowerContent = normalized.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return normalized.slice(0, maxLength) + (normalized.length > maxLength ? "вЂ¦" : "");
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 2));
  const end = Math.min(normalized.length, start + maxLength);
  const excerpt = normalized.slice(start, end);
  const prefix = start > 0 ? "вЂ¦" : "";
  const suffix = end < normalized.length ? "вЂ¦" : "";
  return `${prefix}${excerpt}${suffix}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const isGoogleAuthEnabled = () => Boolean(app.get("googleAuthConfigured"));
  const isYandexAuthEnabled = () => Boolean(app.get("yandexAuthConfigured"));

  app.get("/public/search/suggest", async (req, res) => {
    const parsed = knowledgeSuggestQuerySchema.safeParse({
      q:
        typeof req.query.q === "string"
          ? req.query.q
          : typeof req.query.query === "string"
            ? req.query.query
            : "",
      kb_id:
        typeof req.query.kb_id === "string"
          ? req.query.kb_id
          : typeof req.query.kbId === "string"
            ? req.query.kbId
            : "",
      limit: req.query.limit,
    });

    if (!parsed.success) {
      return res.status(400).json({
        error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ Р·Р°РїСЂРѕСЃР°",
        details: parsed.error.format(),
      });
    }

    const { q, kb_id, limit } = parsed.data;
    const query = q.trim();
    const knowledgeBaseId = kb_id.trim();
    const limitValue = limit !== undefined ? Math.max(1, Math.min(Number(limit), 10)) : 3;

    const requestStartedAt = performance.now();
    const logContext = {
      kb_id: knowledgeBaseId,
      query_length: query.length,
      query_preview: createQueryPreview(query),
      limit: limitValue,
    };

    console.info("[public/search/suggest] РџРѕР»СѓС‡РµРЅ Р·Р°РїСЂРѕСЃ", logContext);

    if (!query) {
      console.warn("[public/search/suggest] РџСѓСЃС‚РѕР№ Р·Р°РїСЂРѕСЃ", logContext);
      return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ РїРѕРёСЃРєРѕРІС‹Р№ Р·Р°РїСЂРѕСЃ" });
    }

    try {
      const base = await storage.getKnowledgeBase(knowledgeBaseId);
      if (!base) {
        console.warn("[public/search/suggest] Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°", logContext);
        return res.status(404).json({ error: "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°" });
      }

      const suggestions = await storage.searchKnowledgeBaseSuggestions(
        knowledgeBaseId,
        query,
        limitValue,
      );
      const duration = performance.now() - requestStartedAt;

      const sections = suggestions.sections.map((entry) => ({
        chunk_id: entry.chunkId,
        doc_id: entry.documentId,
        doc_title: entry.docTitle,
        section_title: entry.sectionTitle,
        snippet: entry.snippet,
        score: entry.score,
        source: entry.source,
        node_id: entry.nodeId ?? null,
        node_slug: entry.nodeSlug ?? null,
      }));

      res.json({
        query,
        kb_id: knowledgeBaseId,
        normalized_query: suggestions.normalizedQuery || query,
        ask_ai: {
          label: "РЎРїСЂРѕСЃРёС‚СЊ AI",
          query: suggestions.normalizedQuery || query,
        },
        sections,
        timings: {
          total_ms: Number(duration.toFixed(2)),
        },
      });

      console.info("[public/search/suggest] РћС‚РІРµС‚ СЃС„РѕСЂРјРёСЂРѕРІР°РЅ", {
        ...logContext,
        workspace_id: base.workspaceId,
        normalized_query: suggestions.normalizedQuery || query,
        sections: sections.length,
        duration_ms: Number(duration.toFixed(2)),
      });
    } catch (error) {
      const durationMs = Number((performance.now() - requestStartedAt).toFixed(2));
      const errorDetails = getErrorDetails(error);

      console.error(
        `[public/search/suggest] РћС€РёР±РєР° РІС‹РґР°С‡Рё РїРѕРґСЃРєР°Р·РѕРє: ${errorDetails}`,
        {
          ...logContext,
          duration_ms: durationMs,
        },
      );

      if (error instanceof Error) {
        console.error(error.stack ?? error);
      } else {
        console.error(error);
      }
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РїРѕРґСЃРєР°Р·РєРё" });
    }
  });

  app.get("/api/public/embed/suggest", async (req, res) => {
    try {
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        return;
      }

      if (!publicContext.embedKey || !publicContext.knowledgeBaseId) {
        res.status(403).json({ error: "РџСѓР±Р»РёС‡РЅС‹Р№ РєР»СЋС‡ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ РїРѕРґСЃРєР°Р·РєРё РїРѕ Р±Р°Р·Рµ Р·РЅР°РЅРёР№" });
        return;
      }

      const queryParam =
        typeof req.query.q === "string"
          ? req.query.q
          : typeof req.query.query === "string"
            ? req.query.query
            : "";
      const query = queryParam.trim();

      if (!query) {
        res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ РїРѕРёСЃРєРѕРІС‹Р№ Р·Р°РїСЂРѕСЃ" });
        return;
      }

      const requestedKbId =
        typeof req.query.kb_id === "string"
          ? req.query.kb_id.trim()
          : typeof req.query.kbId === "string"
            ? req.query.kbId.trim()
            : "";

      if (requestedKbId && requestedKbId !== publicContext.knowledgeBaseId) {
        res.status(403).json({ error: "Р”РѕСЃС‚СѓРї Рє СѓРєР°Р·Р°РЅРЅРѕР№ Р±Р°Р·Рµ Р·РЅР°РЅРёР№ Р·Р°РїСЂРµС‰С‘РЅ" });
        return;
      }

      const limitCandidate = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const limitValue = Number.isFinite(limitCandidate) ? Math.max(1, Math.min(10, Number(limitCandidate))) : 3;

      const knowledgeBaseId = publicContext.knowledgeBaseId;
      const base = await storage.getKnowledgeBase(knowledgeBaseId);

      if (!base) {
        res.status(404).json({ error: "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°" });
        return;
      }

      const startedAt = performance.now();
      const suggestions = await storage.searchKnowledgeBaseSuggestions(knowledgeBaseId, query, limitValue);
      const duration = performance.now() - startedAt;

      const sections = suggestions.sections.map((entry) => ({
        chunk_id: entry.chunkId,
        doc_id: entry.documentId,
        doc_title: entry.docTitle,
        section_title: entry.sectionTitle,
        snippet: entry.snippet,
        score: entry.score,
        source: entry.source,
        node_id: entry.nodeId ?? null,
        node_slug: entry.nodeSlug ?? null,
      }));

      res.json({
        query,
        kb_id: knowledgeBaseId,
        normalized_query: suggestions.normalizedQuery || query,
        ask_ai: {
          label: "РЎРїСЂРѕСЃРёС‚СЊ AI",
          query: suggestions.normalizedQuery || query,
        },
        sections,
        timings: {
          total_ms: Number(duration.toFixed(2)),
        },
      });
    } catch (error) {
      console.error("РћС€РёР±РєР° РїРѕРґСЃРєР°Р·РѕРє РґР»СЏ РІСЃС‚СЂР°РёРІР°РµРјРѕРіРѕ РїРѕРёСЃРєР°:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РїРѕРґСЃРєР°Р·РєРё" });
    }
  });

  app.post("/public/rag/answer", async (req, res) => {
    const parsed = knowledgeRagRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ RAG-Р·Р°РїСЂРѕСЃР°",
        details: parsed.error.format(),
      });
    }

    const body = parsed.data;
    const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
    const wantsStream = Boolean(
      body.stream === true || acceptHeader.toLowerCase().includes("text/event-stream"),
    );

    try {
      if (wantsStream) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        const flusher = (res as Response & { flushHeaders?: () => void }).flushHeaders;
        if (typeof flusher === "function") {
          flusher.call(res);
        }

        try {
          await runKnowledgeBaseRagPipeline({
            req,
            body,
            stream: {
              onEvent: (eventName, payload) => {
                sendSseEvent(res, eventName, payload);
              },
            },
          });
          res.end();
        } catch (error) {
          if (error instanceof HttpError) {
            sendSseEvent(res, "error", { message: error.message, details: error.details ?? null });
            res.end();
            return;
          }

          if (error instanceof QdrantConfigurationError) {
            sendSseEvent(res, "error", { message: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ", details: error.message });
            res.end();
            return;
          }

          console.error("РћС€РёР±РєР° RAG-РїРѕРёСЃРєР° РїРѕ Р±Р°Р·Рµ Р·РЅР°РЅРёР№ (SSE):", error);
          sendSseEvent(res, "error", { message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РѕС‚РІРµС‚ РѕС‚ LLM" });
          res.end();
        }

        return;
      }

      const result = await runKnowledgeBaseRagPipeline({ req, body });
      res.json({
        query: result.response.query,
        kb_id: result.response.knowledgeBaseId,
        normalized_query: result.response.normalizedQuery,
        answer: result.response.answer,
        citations: result.response.citations,
        chunks: result.response.chunks,
        usage: result.response.usage,
        timings: result.response.timings,
        debug: result.response.debug,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details ?? null,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({ error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ", details: error.message });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ RAG-Р·Р°РїСЂРѕСЃР°", details: error.errors });
      }

      console.error("РћС€РёР±РєР° RAG-РїРѕРёСЃРєР° РїРѕ Р±Р°Р·Рµ Р·РЅР°РЅРёР№:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РѕС‚РІРµС‚ РѕС‚ LLM" });
    }
  });

  const registerPublicCollectionRoute = (path: string, handler: RequestHandler) => {
    app.post(path, handler);
  };

  const publicSearchHandler: RequestHandler = async (req, res) => {
    const publicContext = await resolvePublicCollectionRequest(req, res);
    if (!publicContext) {
      return;
    }

    res.status(410).json({
      error: "Р­РЅРґРїРѕРёРЅС‚ СѓРґР°Р»С‘РЅ",
      message: "РџСѓР±Р»РёС‡РЅС‹Р№ РїРѕРёСЃРє РїРѕ СЃС‚Р°СЂС‹Рј СЃС‚СЂР°РЅРёС†Р°Рј Р±РѕР»СЊС€Рµ РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ. РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№.",
    });
  };


  registerPublicCollectionRoute("/api/public/collections/:publicId/search", publicSearchHandler);
  registerPublicCollectionRoute("/api/public/collections/search", publicSearchHandler);

  const publicVectorSearchHandler: RequestHandler = async (req, res) => {
    try {
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        return;
      }

      const workspaceId = publicContext.workspaceId;
      const site = publicContext.site ?? null;
      const bodySource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};
      delete bodySource.workspaceId;
      delete bodySource.workspace_id;
      const body = publicVectorSearchSchema.parse(bodySource);
      const { collection, ...searchOptions } = body;

      const collectionName = collection.trim();
      const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({ error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
      }

      const client = getQdrantClient();
      const searchPayload: Parameters<QdrantClient["search"]>[1] = {
        vector: searchOptions.vector as Schemas["NamedVectorStruct"],
        limit: searchOptions.limit,
      };

      if (searchOptions.offset !== undefined) {
        searchPayload.offset = searchOptions.offset;
      }

      if (searchOptions.filter !== undefined) {
        searchPayload.filter = searchOptions.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (searchOptions.params !== undefined) {
        searchPayload.params = searchOptions.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      if (searchOptions.withPayload !== undefined) {
        searchPayload.with_payload = searchOptions.withPayload as Parameters<
          QdrantClient["search"]
        >[1]["with_payload"];
      }

      if (searchOptions.withVector !== undefined) {
        searchPayload.with_vector = searchOptions.withVector as Parameters<
          QdrantClient["search"]
        >[1]["with_vector"];
      }

      if (searchOptions.scoreThreshold !== undefined) {
        searchPayload.score_threshold = searchOptions.scoreThreshold;
      }

      if (searchOptions.shardKey !== undefined) {
        searchPayload.shard_key = searchOptions.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (searchOptions.consistency !== undefined) {
        searchPayload.consistency = searchOptions.consistency;
      }

      if (searchOptions.timeout !== undefined) {
        searchPayload.timeout = searchOptions.timeout;
      }

      const results = await client.search(collectionName, searchPayload);

      res.json({ collection: collectionName, results });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕРёСЃРєР°",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `РћС€РёР±РєР° Qdrant РїСЂРё РїСѓР±Р»РёС‡РЅРѕРј РІРµРєС‚РѕСЂРЅРѕРј РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.body?.collection ?? "<unknown>"}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error("РћС€РёР±РєР° РїСѓР±Р»РёС‡РЅРѕРіРѕ РІРµРєС‚РѕСЂРЅРѕРіРѕ РїРѕРёСЃРєР°:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РІРµРєС‚РѕСЂРЅС‹Р№ РїРѕРёСЃРє" });
    }
  };

  registerPublicCollectionRoute(
    "/api/public/collections/:publicId/search/vector",
    publicVectorSearchHandler,
  );
  registerPublicCollectionRoute("/api/public/collections/search/vector", publicVectorSearchHandler);

  const publicVectorizeHandler: RequestHandler = async (req, res) => {
    try {
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        return;
      }

      const workspaceId = publicContext.workspaceId;
      const bodySource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};
      delete bodySource.workspaceId;
      delete bodySource.workspace_id;
      const body = publicVectorizeSchema.parse(bodySource);
      const provider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);

      if (!provider) {
        return res.status(404).json({ error: "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!provider.isActive) {
        throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РѕС‚РєР»СЋС‡С‘РЅ");
      }

      let collectionVectorSize: number | null = null;
      let collectionName: string | null = null;

      if (body.collection) {
        collectionName = body.collection.trim();
        if (collectionName.length === 0) {
          collectionName = null;
        }
      }

      if (collectionName) {
        const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);
        if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
          return res.status(404).json({ error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
        }

        try {
          const client = getQdrantClient();
          const info = await client.getCollection(collectionName);
          const vectorsConfig = info.config?.params?.vectors as
            | { size?: number | null }
            | undefined;
          collectionVectorSize = vectorsConfig?.size ?? null;
        } catch (error) {
          const qdrantError = extractQdrantApiError(error);
          if (qdrantError) {
            return res.status(qdrantError.status).json({
              error: qdrantError.message,
              details: qdrantError.details,
            });
          }

          throw error;
        }
      }

      const accessToken = await fetchAccessToken(provider);
      const embeddingResult = await fetchEmbeddingVector(provider, accessToken, body.text);

      if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
        throw new HttpError(
          400,
          `РџРѕР»СѓС‡РµРЅРЅС‹Р№ РІРµРєС‚РѕСЂ РёРјРµРµС‚ РґР»РёРЅСѓ ${embeddingResult.vector.length}, РѕР¶РёРґР°Р»РѕСЃСЊ ${collectionVectorSize}.`,
        );
      }

      res.json({
        vector: embeddingResult.vector,
        vectorLength: embeddingResult.vector.length,
        embeddingId: embeddingResult.embeddingId ?? null,
        usage: { embeddingTokens: embeddingResult.usageTokens ?? null },
        embeddingProvider: {
          id: provider.id,
          name: provider.name,
          model: provider.model,
        },
        collection: collectionName
          ? {
              name: collectionName,
              vectorSize: collectionVectorSize,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РІРµРєС‚РѕСЂРёР·Р°С†РёРё",
          details: error.errors,
        });
      }

      console.error("РћС€РёР±РєР° РїСѓР±Р»РёС‡РЅРѕР№ РІРµРєС‚РѕСЂРёР·Р°С†РёРё С‚РµРєСЃС‚Р°:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РІРµРєС‚РѕСЂРёР·Р°С†РёСЋ" });
    }
  };

  registerPublicCollectionRoute(
    "/api/public/collections/:publicId/vectorize",
    publicVectorizeHandler,
  );
  registerPublicCollectionRoute("/api/public/collections/vectorize", publicVectorizeHandler);

  const publicRagSearchHandler: RequestHandler = async (req, res) => {
    let collectionName = "";
    try {
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        return;
      }

      const { site } = publicContext;
      const embedKey = publicContext.embedKey ?? null;
      const workspaceId = publicContext.workspaceId;

      const baseUrlSet = new Set<string>();
      const registerBaseUrl = (value: unknown) => {
        if (typeof value !== "string") {
          return;
        }

        const trimmed = value.trim();
        if (!trimmed) {
          return;
        }

        try {
          const parsed = new URL(trimmed);
          baseUrlSet.add(parsed.toString());
          baseUrlSet.add(`${parsed.origin}/`);
        } catch {
          // ignore invalid base url candidates
        }
      };

      registerBaseUrl(site?.url);
      if (Array.isArray(site?.startUrls)) {
        for (const startUrl of site.startUrls) {
          registerBaseUrl(startUrl);
        }
      }

      const baseUrls = Array.from(baseUrlSet);

      const payloadSource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};

      const parseBooleanParam = (value: unknown): boolean | undefined => {
        if (typeof value === "boolean") {
          return value;
        }

        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "true" || normalized === "1") {
            return true;
          }
          if (normalized === "false" || normalized === "0") {
            return false;
          }
        }

        return undefined;
      };

      const parseIntegerParam = (value: unknown): number | undefined => {
        if (typeof value === "number" && Number.isInteger(value)) {
          return value;
        }

        if (typeof value === "string") {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }

        return undefined;
      };

      const parseNumberParam = (value: unknown): number | undefined => {
        if (typeof value === "number") {
          return Number.isFinite(value) ? value : undefined;
        }

        if (typeof value === "string") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }

        return undefined;
      };

      delete payloadSource.apiKey;
      delete payloadSource.publicId;
      delete payloadSource.sitePublicId;
      delete payloadSource.workspaceId;
      delete payloadSource.workspace_id;

      if (!("query" in payloadSource)) {
        if (typeof req.query.q === "string" && req.query.q.trim()) {
          payloadSource.query = req.query.q.trim();
        } else if (typeof req.query.query === "string" && req.query.query.trim()) {
          payloadSource.query = req.query.query.trim();
        }
      }

      if (!("embeddingProviderId" in payloadSource) && typeof req.query.embeddingProviderId === "string") {
        payloadSource.embeddingProviderId = req.query.embeddingProviderId;
      }

      if (!("llmProviderId" in payloadSource) && typeof req.query.llmProviderId === "string") {
        payloadSource.llmProviderId = req.query.llmProviderId;
      }

      if (!("llmModel" in payloadSource) && typeof req.query.llmModel === "string") {
        payloadSource.llmModel = req.query.llmModel;
      }

      if (!("limit" in payloadSource)) {
        const parsedLimit = parseIntegerParam(req.query.limit);
        if (parsedLimit !== undefined) {
          payloadSource.limit = parsedLimit;
        }
      }

      if (!("contextLimit" in payloadSource)) {
        const parsedContextLimit = parseIntegerParam(req.query.contextLimit);
        if (parsedContextLimit !== undefined) {
          payloadSource.contextLimit = parsedContextLimit;
        }
      }

      if (!("topK" in payloadSource)) {
        const parsedTopK = parseIntegerParam(req.query.topK ?? req.query.top_k);
        if (parsedTopK !== undefined) {
          payloadSource.topK = parsedTopK;
        }
      }

      if (!("kbId" in payloadSource)) {
        const kbCandidate =
          typeof req.query.kbId === "string"
            ? req.query.kbId
            : typeof req.query.kb_id === "string"
            ? req.query.kb_id
            : undefined;
        if (kbCandidate) {
          payloadSource.kbId = kbCandidate;
        }
      }

      if (!("llmTemperature" in payloadSource)) {
        const parsedTemperature = parseNumberParam(req.query.llmTemperature);
        if (parsedTemperature !== undefined) {
          payloadSource.llmTemperature = parsedTemperature;
        }
      }

      if (!("llmMaxTokens" in payloadSource)) {
        const parsedMaxTokens = parseIntegerParam(
          req.query.llmMaxTokens ?? req.query.maxTokens,
        );
        if (parsedMaxTokens !== undefined) {
          payloadSource.llmMaxTokens = parsedMaxTokens;
        }
      }

      if (!("llmSystemPrompt" in payloadSource) && typeof req.query.llmSystemPrompt === "string") {
        payloadSource.llmSystemPrompt = req.query.llmSystemPrompt;
      }

      if (!("llmResponseFormat" in payloadSource) && typeof req.query.llmResponseFormat === "string") {
        payloadSource.llmResponseFormat = req.query.llmResponseFormat;
      }

      if (!("includeContext" in payloadSource)) {
        const parsedIncludeContext = parseBooleanParam(req.query.includeContext);
        if (parsedIncludeContext !== undefined) {
          payloadSource.includeContext = parsedIncludeContext;
        }
      }

      if (!("includeQueryVector" in payloadSource)) {
        const parsedIncludeQueryVector = parseBooleanParam(req.query.includeQueryVector);
        if (parsedIncludeQueryVector !== undefined) {
          payloadSource.includeQueryVector = parsedIncludeQueryVector;
        }
      }

      if (!("withPayload" in payloadSource)) {
        const parsedWithPayload = parseBooleanParam(req.query.withPayload);
        if (parsedWithPayload !== undefined) {
          payloadSource.withPayload = parsedWithPayload;
        }
      }

      if (!("withVector" in payloadSource)) {
        const parsedWithVector = parseBooleanParam(req.query.withVector);
        if (parsedWithVector !== undefined) {
          payloadSource.withVector = parsedWithVector;
        }
      }

      if (!("collection" in payloadSource) && typeof req.query.collection === "string") {
        const candidate = req.query.collection.trim();
        if (candidate) {
          payloadSource.collection = candidate;
        }
      }

      if (!("responseFormat" in payloadSource) && typeof req.query.format === "string") {
        const candidate = req.query.format.trim();
        if (candidate) {
          payloadSource.responseFormat = candidate;
        }
      }

      const streamParamBeforeParse = payloadSource.stream;

      const body = publicGenerativeSearchSchema.parse(payloadSource);
      collectionName = body.collection.trim();

      if (embedKey && collectionName !== embedKey.collection) {
        return res.status(403).json({ error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµРґРѕСЃС‚СѓРїРЅР° РґР»СЏ РґР°РЅРЅРѕРіРѕ РєР»СЋС‡Р°" });
      }

      const responseFormatCandidate = normalizeResponseFormat(body.responseFormat);
      if (responseFormatCandidate === null) {
        return res.status(400).json({
          error: "Неверный формат ответа",
          details: "Допустимые варианты формата: text, md/markdown или html",
        });
      }

      const responseFormat: RagResponseFormat = responseFormatCandidate ?? "text";
      const includeContextInResponse = body.includeContext ?? true;
      const includeQueryVectorInResponse = body.includeQueryVector ?? true;

      const llmResponseFormatCandidate = normalizeResponseFormat(body.llmResponseFormat);
      if (llmResponseFormatCandidate === null) {
        return res.status(400).json({
          error: "Неверный формат ответа LLM",
          details: "Допустимые варианты формата: text, md/markdown или html",
        });
      }

      const llmResponseFormatRaw =
        llmResponseFormatCandidate ??
        (typeof body.responseFormat === "string" ? body.responseFormat : responseFormat);
      const llmResponseFormatNormalized =
        llmResponseFormatCandidate ?? responseFormat;
      
      console.log(`[RAG DEBUG] Looking up collection "${collectionName}" workspace...`);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);
      console.log(
        `[RAG DEBUG] Collection workspace: ${ownerWorkspaceId || 'NOT FOUND'}, Request workspace: ${workspaceId}, Match: ${ownerWorkspaceId === workspaceId}`,
      );

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({ error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
      }

      const knowledgeBaseId =
        publicContext.knowledgeBaseId ?? embedKey?.knowledgeBaseId ?? null;

      if (knowledgeBaseId) {
        const ragTopK = Math.max(
          1,
          Math.min(body.contextLimit ?? body.limit ?? 6, 20),
        );
        const vectorLimitForPipeline = Math.max(
          1,
          Math.min(body.limit ?? ragTopK, 50),
        );

        const ragRequest: KnowledgeRagRequest = {
          q: body.query,
          kb_id: knowledgeBaseId,
          top_k: ragTopK,
          hybrid: {
            bm25: {
              limit: ragTopK,
            },
            vector: {
              limit: vectorLimitForPipeline,
              collection: collectionName,
              embedding_provider_id: body.embeddingProviderId,
            },
          },
          llm: {
            provider: body.llmProviderId,
            model: body.llmModel ?? undefined,
            temperature: undefined,
            max_tokens: undefined,
            system_prompt: undefined,
            response_format: body.responseFormat,
          },
        };

        const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
        const wantsStream = Boolean(
          streamParamBeforeParse === true || acceptHeader.toLowerCase().includes("text/event-stream"),
        );

        console.log('[RAG STREAM DEBUG] streamParamBeforeParse:', streamParamBeforeParse);
        console.log('[RAG STREAM DEBUG] acceptHeader:', acceptHeader);
        console.log('[RAG STREAM DEBUG] wantsStream:', wantsStream);

        if (wantsStream) {
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          const flusher = (res as Response & { flushHeaders?: () => void }).flushHeaders;
          if (typeof flusher === "function") {
            flusher.call(res);
          }

          try {
            await runKnowledgeBaseRagPipeline({
              req,
              body: ragRequest,
              stream: {
                onEvent: (eventName, payload) => {
                  sendSseEvent(res, eventName, payload);
                },
              },
            });
            res.end();
          } catch (error) {
            if (error instanceof HttpError) {
              sendSseEvent(res, "error", { message: error.message, details: error.details ?? null });
              res.end();
              return;
            }

            if (error instanceof QdrantConfigurationError) {
              sendSseEvent(res, "error", { message: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ", details: error.message });
              res.end();
              return;
            }

            console.error("РћС€РёР±РєР° RAG-РїРѕРёСЃРєР° (SSE):", error);
            sendSseEvent(res, "error", { message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РѕС‚РІРµС‚ РѕС‚ LLM" });
            res.end();
          }

          return;
        }

        const pipelineResult = await runKnowledgeBaseRagPipeline({
          req,
          body: ragRequest,
        });

        const sanitizedResults = pipelineResult.metadata.sanitizedVectorResults;
        const contextLimit = Math.max(
          0,
          Math.min(body.contextLimit ?? sanitizedResults.length, sanitizedResults.length),
        );

        const sourcesMap = new Map<
          string,
          {
            url: string;
            title: string | null;
            snippet: string | null;
            chunkId: string | null;
            documentId: string | null;
          }
        >();

        for (const entry of sanitizedResults) {
          const payloadRecord = toRecord(entry.payload);
          if (!payloadRecord) {
            continue;
          }

          const chunkRecord = toRecord(payloadRecord.chunk);
          const documentRecord = toRecord(payloadRecord.document);
          const metadataRecord = toRecord(chunkRecord?.metadata);

          const sourceUrl = pickAbsoluteUrl(
            baseUrls,
            metadataRecord?.sourceUrl,
            metadataRecord?.source_url,
            chunkRecord?.deepLink,
            chunkRecord?.sourceUrl,
            documentRecord?.sourceUrl,
            documentRecord?.url,
            documentRecord?.path,
          );

          if (!sourceUrl) {
            continue;
          }

          const sourceTitle = pickFirstString(
            chunkRecord?.title,
            metadataRecord?.title,
            metadataRecord?.heading,
            metadataRecord?.sectionTitle,
            documentRecord?.title,
          );

          const snippet = buildSourceSnippet(
            metadataRecord?.snippet,
            metadataRecord?.excerpt,
            chunkRecord?.excerpt,
            chunkRecord?.text,
            documentRecord?.excerpt,
          );

          const chunkId = pickFirstString(chunkRecord?.id);
          const documentId = pickFirstString(documentRecord?.id);

          if (!sourcesMap.has(sourceUrl)) {
            sourcesMap.set(sourceUrl, {
              url: sourceUrl,
              title: sourceTitle ?? null,
              snippet,
              chunkId: chunkId ?? null,
              documentId: documentId ?? null,
            });
          }
        }

        const responsePayload: Record<string, unknown> = {
          answer: pipelineResult.response.answer,
          format: pipelineResult.response.responseFormat,
          usage: pipelineResult.response.usage,
          provider: {
            id: pipelineResult.metadata.llmProvider.id,
            name: pipelineResult.metadata.llmProvider.name,
            model:
              pipelineResult.metadata.llmModel ?? pipelineResult.metadata.llmProvider.model,
            modelLabel:
              pipelineResult.metadata.llmModelLabel ??
              pipelineResult.metadata.llmModel ??
              pipelineResult.metadata.llmProvider.model,
          },
          embeddingProvider: pipelineResult.metadata.embeddingProvider
            ? {
                id: pipelineResult.metadata.embeddingProvider.id,
                name: pipelineResult.metadata.embeddingProvider.name,
              }
            : null,
          collection: collectionName,
          citations: pipelineResult.response.citations,
          chunks: pipelineResult.response.chunks,
          timings: pipelineResult.response.timings,
          debug: pipelineResult.response.debug,
        };

        const maxSources = (() => {
          if (contextLimit > 0) {
            return contextLimit;
          }
          if (body.limit && body.limit > 0) {
            return Math.min(body.limit, sourcesMap.size);
          }
          return sourcesMap.size;
        })();

        const limitedSources = Array.from(sourcesMap.values()).slice(0, maxSources);
        if (limitedSources.length > 0) {
          responsePayload.sources = limitedSources.map((source) => ({
            url: source.url,
            title: source.title,
            snippet: source.snippet,
            chunkId: source.chunkId,
            documentId: source.documentId,
          }));
        }

        if (includeContextInResponse) {
          responsePayload.context = sanitizedResults;
        }

        const embeddingResult = pipelineResult.metadata.embeddingResult;
        if (includeQueryVectorInResponse && embeddingResult) {
          responsePayload.queryVector = embeddingResult.vector;
          responsePayload.vectorLength = embeddingResult.vector.length;
        }

        res.json(responsePayload);
        return;
      }

      const embeddingProvider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);
      if (!embeddingProvider) {
        return res.status(404).json({ error: "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!embeddingProvider.isActive) {
        throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РѕС‚РєР»СЋС‡С‘РЅ");
      }

      const llmProvider = await storage.getLlmProvider(body.llmProviderId, workspaceId);
      if (!llmProvider) {
        return res.status(404).json({ error: "РџСЂРѕРІР°Р№РґРµСЂ LLM РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!llmProvider.isActive) {
        throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ РїСЂРѕРІР°Р№РґРµСЂ LLM РѕС‚РєР»СЋС‡С‘РЅ");
      }

      const llmRequestConfig = mergeLlmRequestConfig(llmProvider);

      if (body.llmSystemPrompt !== undefined) {
        llmRequestConfig.systemPrompt = body.llmSystemPrompt || undefined;
      }

      if (body.llmTemperature !== undefined) {
        llmRequestConfig.temperature = body.llmTemperature;
      }

      if (body.llmMaxTokens !== undefined) {
        llmRequestConfig.maxTokens = body.llmMaxTokens;
      }

      const configuredLlmProvider: LlmProvider = {
        ...llmProvider,
        requestConfig: llmRequestConfig,
      };

      const sanitizedModels = sanitizeLlmModelOptions(configuredLlmProvider.availableModels);
      const requestedModel = typeof body.llmModel === "string" ? body.llmModel.trim() : "";
      const normalizedModelFromList =
        sanitizedModels.find((model) => model.value === requestedModel)?.value ??
        sanitizedModels.find((model) => model.label === requestedModel)?.value ??
        null;
      const selectedModelValue =
        (normalizedModelFromList && normalizedModelFromList.trim().length > 0
          ? normalizedModelFromList.trim()
          : undefined) ??
        (requestedModel.length > 0 ? requestedModel : undefined) ??
        configuredLlmProvider.model;
      const selectedModelMeta =
        sanitizedModels.find((model) => model.value === selectedModelValue) ?? null;

      const client = getQdrantClient();
      const collectionInfo = await client.getCollection(collectionName);
      const vectorsConfig = collectionInfo.config?.params?.vectors as
        | { size?: number | null }
        | undefined;
      const collectionVectorSize = vectorsConfig?.size ?? null;
      const providerVectorSize = parseVectorSize(embeddingProvider.qdrantConfig?.vectorSize);

      if (
        collectionVectorSize &&
        providerVectorSize &&
        Number(collectionVectorSize) !== Number(providerVectorSize)
      ) {
        throw new HttpError(
          400,
          `Р Р°Р·РјРµСЂ РІРµРєС‚РѕСЂР° РєРѕР»Р»РµРєС†РёРё (${collectionVectorSize}) РЅРµ СЃРѕРІРїР°РґР°РµС‚ СЃ РЅР°СЃС‚СЂРѕР№РєРѕР№ СЃРµСЂРІРёСЃР° (${providerVectorSize}).`,
        );
      }

      const embeddingAccessToken = await fetchAccessToken(embeddingProvider);
      const embeddingResult = await fetchEmbeddingVector(embeddingProvider, embeddingAccessToken, body.query);

      if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
        throw new HttpError(
          400,
          `РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» РІРµРєС‚РѕСЂ РґР»РёРЅРѕР№ ${embeddingResult.vector.length}, РѕР¶РёРґР°Р»РѕСЃСЊ ${collectionVectorSize}.`,
        );
      }

      const searchPayload: Parameters<QdrantClient["search"]>[1] = {
        vector: buildVectorPayload(
          embeddingResult.vector,
          embeddingProvider.qdrantConfig?.vectorFieldName,
        ),
        limit: body.limit,
      };

      if (body.offset !== undefined) {
        searchPayload.offset = body.offset;
      }

      if (body.filter !== undefined) {
        searchPayload.filter = body.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (body.params !== undefined) {
        searchPayload.params = body.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      searchPayload.with_payload = (body.withPayload ?? true) as Parameters<QdrantClient["search"]>[1]["with_payload"];

      if (body.withVector !== undefined) {
        searchPayload.with_vector = body.withVector as Parameters<QdrantClient["search"]>[1]["with_vector"];
      }

      if (body.scoreThreshold !== undefined) {
        searchPayload.score_threshold = body.scoreThreshold;
      }

      if (body.shardKey !== undefined) {
        searchPayload.shard_key = body.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (body.consistency !== undefined) {
        searchPayload.consistency = body.consistency;
      }

      if (body.timeout !== undefined) {
        searchPayload.timeout = body.timeout;
      }

      const results = await client.search(collectionName, searchPayload);
      const sanitizedResults = results.map((result) => {
        const payload = result.payload ?? null;
        return {
          id: result.id,
          payload,
          score: result.score ?? null,
          shard_key: result.shard_key ?? null,
          order_value: result.order_value ?? null,
        };
      });

      const sourcesMap = new Map<
        string,
        {
          url: string;
          title: string | null;
          snippet: string | null;
          chunkId: string | null;
          documentId: string | null;
        }
      >();

      for (const entry of sanitizedResults) {
        const payloadRecord = toRecord(entry.payload);
        if (!payloadRecord) {
          continue;
        }

        const chunkRecord = toRecord(payloadRecord.chunk);
        const documentRecord = toRecord(payloadRecord.document);
        const metadataRecord = toRecord(chunkRecord?.metadata);

        const sourceUrl = pickAbsoluteUrl(
          baseUrls,
          metadataRecord?.sourceUrl,
          metadataRecord?.source_url,
          chunkRecord?.deepLink,
          chunkRecord?.sourceUrl,
          documentRecord?.sourceUrl,
          documentRecord?.url,
          documentRecord?.path,
        );

        if (!sourceUrl) {
          continue;
        }

        const sourceTitle = pickFirstString(
          chunkRecord?.title,
          metadataRecord?.title,
          metadataRecord?.heading,
          metadataRecord?.sectionTitle,
          documentRecord?.title,
        );

        const snippet = buildSourceSnippet(
          metadataRecord?.snippet,
          metadataRecord?.excerpt,
          chunkRecord?.excerpt,
          chunkRecord?.text,
          documentRecord?.excerpt,
        );

        const chunkId = pickFirstString(chunkRecord?.id);
        const documentId = pickFirstString(documentRecord?.id);

        if (!sourcesMap.has(sourceUrl)) {
          sourcesMap.set(sourceUrl, {
            url: sourceUrl,
            title: sourceTitle ?? null,
            snippet,
            chunkId: chunkId ?? null,
            documentId: documentId ?? null,
          });
        }
      }

      const desiredContext = body.contextLimit ?? sanitizedResults.length;
      const contextLimit = Math.max(0, Math.min(desiredContext, sanitizedResults.length));
      const contextRecords: LlmContextRecord[] = sanitizedResults.slice(0, contextLimit).map((entry, index) => {
        const basePayload = entry.payload;
        let contextPayload: Record<string, unknown> | null = null;

        if (basePayload && typeof basePayload === "object" && !Array.isArray(basePayload)) {
          contextPayload = { ...(basePayload as Record<string, unknown>) };
        } else if (basePayload !== null && basePayload !== undefined) {
          contextPayload = { value: basePayload };
        }

        return {
          index: index + 1,
          score: typeof entry.score === "number" ? entry.score : null,
          payload: contextPayload,
        } satisfies LlmContextRecord;
      });

      const llmAccessToken = await fetchAccessToken(configuredLlmProvider);
      const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
      const wantsStreamingResponse =
        configuredLlmProvider.providerType === "gigachat" && acceptHeader.toLowerCase().includes("text/event-stream");

      if (wantsStreamingResponse) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        await streamGigachatCompletion({
          req,
          res,
          provider: configuredLlmProvider,
          accessToken: llmAccessToken,
          query: body.query,
          context: contextRecords,
          sanitizedResults,
          embeddingResult,
          embeddingProvider,
          selectedModelValue,
          selectedModelMeta,
          limit: body.limit,
          contextLimit,
          responseFormat: llmResponseFormatNormalized,
          includeContextInResponse,
          includeQueryVectorInResponse,
          collectionName: typeof req.params.name === "string" ? req.params.name : "",
        });
        return;
      }

      const completion = await fetchLlmCompletion(
        configuredLlmProvider,
        llmAccessToken,
        body.query,
        contextRecords,
        selectedModelValue,
        { responseFormat: llmResponseFormatNormalized },
      );

      const responsePayload: Record<string, unknown> = {
        answer: completion.answer,
        format: llmResponseFormatNormalized,
        usage: {
          embeddingTokens: embeddingResult.usageTokens ?? null,
          llmTokens: completion.usageTokens ?? null,
        },
        provider: {
          id: configuredLlmProvider.id,
          name: configuredLlmProvider.name,
          model: selectedModelValue,
          modelLabel: selectedModelMeta?.label ?? selectedModelValue,
        },
        embeddingProvider: {
          id: embeddingProvider.id,
          name: embeddingProvider.name,
        },
        collection: collectionName,
      };

      const maxSources = (() => {
        if (contextLimit > 0) {
          return contextLimit;
        }
        if (body.limit && body.limit > 0) {
          return body.limit;
        }
        return sourcesMap.size;
      })();

      const limitedSources = Array.from(sourcesMap.values()).slice(0, maxSources);
      if (limitedSources.length > 0) {
        responsePayload.sources = limitedSources.map((source) => ({
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          chunkId: source.chunkId,
          documentId: source.documentId,
        }));
      }

      if (includeContextInResponse) {
        responsePayload.context = sanitizedResults;
      }

      if (includeQueryVectorInResponse) {
        responsePayload.queryVector = embeddingResult.vector;
        responsePayload.vectorLength = embeddingResult.vector.length;
      }

      res.json(responsePayload);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РіРµРЅРµСЂР°С‚РёРІРЅРѕРіРѕ РїРѕРёСЃРєР°",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `РћС€РёР±РєР° Qdrant РїСЂРё РїСѓР±Р»РёС‡РЅРѕРј РіРµРЅРµСЂР°С‚РёРІРЅРѕРј РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${collectionName}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error("РћС€РёР±РєР° РїСѓР±Р»РёС‡РЅРѕРіРѕ RAG-РїРѕРёСЃРєР°:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РѕС‚РІРµС‚ РѕС‚ LLM" });
    }
  };

  registerPublicCollectionRoute(
    "/api/public/collections/:publicId/search/rag",
    publicRagSearchHandler,
  );
  registerPublicCollectionRoute("/api/public/collections/search/rag", publicRagSearchHandler);

  app.post("/api/embed/keys", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const collection = typeof req.body?.collection === "string" ? req.body.collection.trim() : "";
      const knowledgeBaseId =
        typeof req.body?.knowledgeBaseId === "string"
          ? req.body.knowledgeBaseId.trim()
          : typeof req.body?.knowledge_base_id === "string"
            ? req.body.knowledge_base_id.trim()
            : "";

      if (!collection) {
        return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РєРѕР»Р»РµРєС†РёРё" });
      }

      if (!knowledgeBaseId) {
        return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ Р±Р°Р·С‹ Р·РЅР°РЅРёР№" });
      }

      const base = await storage.getKnowledgeBase(knowledgeBaseId);
      if (!base || base.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР° РІ С‚РµРєСѓС‰РµРј workspace" });
      }

      const embedKey = await storage.getOrCreateWorkspaceEmbedKey(workspaceId, collection, knowledgeBaseId);
      const domains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id, workspaceId);

      res.json({ key: embedKey, domains });
    } catch (error) {
      console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РїСѓР±Р»РёС‡РЅС‹Р№ РєР»СЋС‡ РІСЃС‚СЂР°РёРІР°РЅРёСЏ:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРіРѕС‚РѕРІРёС‚СЊ РїСѓР±Р»РёС‡РЅС‹Р№ РєР»СЋС‡" });
    }
  });

  app.get("/api/embed/keys/:id/domains", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const embedKey = await storage.getWorkspaceEmbedKey(req.params.id, workspaceId);

      if (!embedKey) {
        return res.status(404).json({ error: "РџСѓР±Р»РёС‡РЅС‹Р№ РєР»СЋС‡ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const domains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id, workspaceId);
      res.json({ key: embedKey, domains });
    } catch (error) {
      console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃРїРёСЃРѕРє РґРѕРјРµРЅРѕРІ РґР»СЏ РєР»СЋС‡Р°:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃРїРёСЃРѕРє РґРѕРјРµРЅРѕРІ" });
    }
  });

  app.post("/api/embed/keys/:id/domains", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const embedKey = await storage.getWorkspaceEmbedKey(req.params.id, workspaceId);

      if (!embedKey) {
        return res.status(404).json({ error: "РџСѓР±Р»РёС‡РЅС‹Р№ РєР»СЋС‡ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const domainCandidate =
        typeof req.body?.domain === "string"
          ? req.body.domain
          : typeof req.body?.hostname === "string"
            ? req.body.hostname
            : "";

      const normalized = normalizeDomainCandidate(domainCandidate);
      if (!normalized) {
        return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ РєРѕСЂСЂРµРєС‚РЅРѕРµ РґРѕРјРµРЅРЅРѕРµ РёРјСЏ" });
      }

      const domainEntry = await storage.addWorkspaceEmbedKeyDomain(embedKey.id, workspaceId, normalized);
      if (!domainEntry) {
        return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР±Р°РІРёС‚СЊ РґРѕРјРµРЅ" });
      }

      invalidateCorsCache();
      res.status(201).json(domainEntry);
    } catch (error) {
      console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР±Р°РІРёС‚СЊ РґРѕРјРµРЅ РґР»СЏ РїСѓР±Р»РёС‡РЅРѕРіРѕ РєР»СЋС‡Р°:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР±Р°РІРёС‚СЊ РґРѕРјРµРЅ" });
    }
  });

  app.delete("/api/embed/keys/:id/domains/:domainId", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const embedKey = await storage.getWorkspaceEmbedKey(req.params.id, workspaceId);

      if (!embedKey) {
        return res.status(404).json({ error: "РџСѓР±Р»РёС‡РЅС‹Р№ РєР»СЋС‡ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const removed = await storage.removeWorkspaceEmbedKeyDomain(embedKey.id, req.params.domainId, workspaceId);
      if (!removed) {
        return res.status(404).json({ error: "Р”РѕРјРµРЅ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      invalidateCorsCache();
      res.status(204).send();
    } catch (error) {
      console.error("РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РґРѕРјРµРЅ РёР· allowlist:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РґРѕРјРµРЅ" });
    }
  });

  app.get("/api/auth/providers", (_req, res) => {
    const googleAuthEnabled = isGoogleAuthEnabled();
    const yandexAuthEnabled = isYandexAuthEnabled();
    res.json({
      providers: {
        local: { enabled: true },
        google: { enabled: googleAuthEnabled },
        yandex: { enabled: yandexAuthEnabled },
      },
    });
  });

  app.get("/api/auth/session", async (req, res, next) => {
    try {
      const user = getSessionUser(req);
      if (!user) {
        return res.status(401).json({ message: "РќРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРµСЃСЃРёРё" });
      }

      const updatedUser = await storage.recordUserActivity(user.id);
      const safeUser = updatedUser ? toPublicUser(updatedUser) : user;
      if (updatedUser) {
        req.user = safeUser;
      }
      const context = await ensureWorkspaceContext(req, safeUser);
      res.json(buildSessionResponse(safeUser, context));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/google", (req, res, next) => {
    const googleAuthEnabled = isGoogleAuthEnabled();
    if (!googleAuthEnabled) {
      res.status(404).json({ message: "РђРІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· Google РЅРµРґРѕСЃС‚СѓРїРЅР°" });
      return;
    }

    const redirectCandidate = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const redirectTo = sanitizeRedirectPath(redirectCandidate);

    if (req.session) {
      req.session.oauthRedirectTo = redirectTo;
    }

    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    })(req, res, next);
  });

  app.get("/api/auth/google/callback", (req, res, next) => {
    const googleAuthEnabled = isGoogleAuthEnabled();
    if (!googleAuthEnabled) {
      res.status(404).json({ message: "РђРІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· Google РЅРµРґРѕСЃС‚СѓРїРЅР°" });
      return;
    }

    passport.authenticate("google", (err: unknown, user: PublicUser | false) => {
      const redirectTo = sanitizeRedirectPath(req.session?.oauthRedirectTo ?? "/");
      if (req.session) {
        delete req.session.oauthRedirectTo;
      }

      if (err) {
        console.error("РћС€РёР±РєР° Google OAuth:", err);
        return res.redirect(appendAuthErrorParam(redirectTo, "google"));
      }

      if (!user) {
        return res.redirect(appendAuthErrorParam(redirectTo, "google"));
      }

      req.logIn(user, (loginError) => {
        if (loginError) {
          return next(loginError);
        }

        res.redirect(redirectTo);
      });
    })(req, res, next);
  });

  app.get("/api/auth/yandex", (req, res, next) => {
    const yandexAuthEnabled = isYandexAuthEnabled();
    if (!yandexAuthEnabled) {
      res.status(404).json({ message: "РђРІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· Yandex РЅРµРґРѕСЃС‚СѓРїРЅР°" });
      return;
    }

    const redirectCandidate = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const redirectTo = sanitizeRedirectPath(redirectCandidate);

    if (req.session) {
      req.session.oauthRedirectTo = redirectTo;
    }

    passport.authenticate("yandex", {
      scope: ["login:info", "login:email"],
    })(req, res, next);
  });

  app.get("/api/auth/yandex/callback", (req, res, next) => {
    const yandexAuthEnabled = isYandexAuthEnabled();
    if (!yandexAuthEnabled) {
      res.status(404).json({ message: "РђРІС‚РѕСЂРёР·Р°С†РёСЏ С‡РµСЂРµР· Yandex РЅРµРґРѕСЃС‚СѓРїРЅР°" });
      return;
    }

    passport.authenticate("yandex", (err: unknown, user: PublicUser | false) => {
      const redirectTo = sanitizeRedirectPath(req.session?.oauthRedirectTo ?? "/");
      if (req.session) {
        delete req.session.oauthRedirectTo;
      }

      if (err) {
        console.error("РћС€РёР±РєР° Yandex OAuth:", err);
        return res.redirect(appendAuthErrorParam(redirectTo, "yandex"));
      }

      if (!user) {
        return res.redirect(appendAuthErrorParam(redirectTo, "yandex"));
      }

      req.logIn(user, (loginError) => {
        if (loginError) {
          return next(loginError);
        }

        res.redirect(redirectTo);
      });
    })(req, res, next);
  });

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const payload = registerUserSchema.parse(req.body);
      const email = payload.email.trim().toLowerCase();
      const fullName = payload.fullName.trim();

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ С‚Р°РєРёРј email СѓР¶Рµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ" });
      }

      const passwordHash = await bcrypt.hash(payload.password, 12);
      const { firstName, lastName } = splitFullName(fullName);
      const user = await storage.createUser({
        email,
        fullName,
        firstName,
        lastName,
        phone: "",
        passwordHash,
      });

      const updatedUser = await storage.recordUserActivity(user.id);
      const safeUser = toPublicUser(updatedUser ?? user);
      req.logIn(safeUser, (error) => {
        if (error) {
          return next(error);
        }
        void (async () => {
          try {
            const context = await ensureWorkspaceContext(req, safeUser);
            res.status(201).json(buildSessionResponse(safeUser, context));
          } catch (workspaceError) {
            next(workspaceError as Error);
          }
        })();
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: unknown, user: PublicUser | false, info?: { message?: string }) => {
      if (err) {
        return next(err);
      }

      if (!user) {
        return res.status(401).json({ message: info?.message ?? "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ" });
      }

      req.logIn(user, (loginError) => {
        if (loginError) {
          return next(loginError);
        }
        void (async () => {
          try {
            const updatedUser = await storage.recordUserActivity(user.id);
            const fullUser = updatedUser ?? (await storage.getUser(user.id));
            const safeUser = fullUser ? toPublicUser(fullUser) : user;
            req.user = safeUser;
            const context = await ensureWorkspaceContext(req, safeUser);
            res.json(buildSessionResponse(safeUser, context));
          } catch (workspaceError) {
            next(workspaceError as Error);
          }
        })();
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res, next) => {
    req.logout((error) => {
      if (error) {
        return next(error);
      }

      if (req.session) {
        delete req.session.workspaceId;
      }

      res.json({ success: true });
    });
  });

  app.use("/api", requireAuth);

  const updateProfileSchema = z.object({
    firstName: z
      .string()
      .trim()
      .min(1, "Р’РІРµРґРёС‚Рµ РёРјСЏ")
      .max(100, "РЎР»РёС€РєРѕРј РґР»РёРЅРЅРѕРµ РёРјСЏ"),
    lastName: z
      .string()
      .trim()
      .max(120, "РЎР»РёС€РєРѕРј РґР»РёРЅРЅР°СЏ С„Р°РјРёР»РёСЏ")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(30, "РЎР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№ РЅРѕРјРµСЂ")
      .optional()
      .refine((value) => !value || /^[0-9+()\s-]*$/.test(value), "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РЅРѕРјРµСЂ С‚РµР»РµС„РѕРЅР°"),
  });

  const switchWorkspaceSchema = z.object({
    workspaceId: z.string().trim().min(1, "РЈРєР°Р¶РёС‚Рµ СЂР°Р±РѕС‡РµРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ"),
  });

  const inviteWorkspaceMemberSchema = z.object({
    email: z.string().trim().email("Р’РІРµРґРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ email"),
    role: z.enum(workspaceMemberRoles).default("user"),
  });

  const updateWorkspaceMemberSchema = z.object({
    role: z.enum(workspaceMemberRoles),
  });

  app.get("/api/workspaces", async (req, res, next) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const context = await ensureWorkspaceContext(req, user);
      res.json(buildSessionResponse(user, context).workspace);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspaces/switch", async (req, res, next) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const payload = switchWorkspaceSchema.parse(req.body);
      const memberships = getRequestWorkspaceMemberships(req);
      const target = memberships.find((workspace) => workspace.id === payload.workspaceId);
      if (!target) {
        return res.status(404).json({ message: "Р Р°Р±РѕС‡РµРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ РЅРµ РЅР°Р№РґРµРЅРѕ" });
      }

      if (req.session) {
        req.session.workspaceId = target.id;
      }

      req.workspaceId = target.id;
      req.workspaceRole = target.role;

      const context = await ensureWorkspaceContext(req, user);
      res.json(buildSessionResponse(user, context));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }
      next(error);
    }
  });

  app.get("/api/workspaces/members", async (req, res, next) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const members = await storage.listWorkspaceMembers(workspaceId);
      res.json({ members: members.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/workspaces/members", async (req, res, next) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const payload = inviteWorkspaceMemberSchema.parse(req.body);
      const normalizedEmail = payload.email.trim().toLowerCase();
      const targetUser = await storage.getUserByEmail(normalizedEmail);
      if (!targetUser) {
        return res.status(404).json({ message: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ С‚Р°РєРёРј email РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const { id: workspaceId } = getRequestWorkspace(req);
      const existingMembers = await storage.listWorkspaceMembers(workspaceId);
      if (existingMembers.some((entry) => entry.user.id === targetUser.id)) {
        return res.status(409).json({ message: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СѓР¶Рµ СЃРѕСЃС‚РѕРёС‚ РІ СЂР°Р±РѕС‡РµРј РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРµ" });
      }

      await storage.addWorkspaceMember(workspaceId, targetUser.id, payload.role);
      const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
      res.status(201).json({
        members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }
      next(error);
    }
  });

  app.patch("/api/workspaces/members/:memberId", async (req, res, next) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const payload = updateWorkspaceMemberSchema.parse(req.body);
      const { id: workspaceId } = getRequestWorkspace(req);
      const members = await storage.listWorkspaceMembers(workspaceId);
      const target = members.find((entry) => entry.user.id === req.params.memberId);
      if (!target) {
        return res.status(404).json({ message: "РЈС‡Р°СЃС‚РЅРёРє РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const ownerCount = members.filter((entry) => entry.member.role === "owner").length;
      if (target.member.role === "owner" && payload.role !== "owner" && ownerCount <= 1) {
        return res.status(400).json({ message: "РќРµР»СЊР·СЏ РёР·РјРµРЅРёС‚СЊ СЂРѕР»СЊ РµРґРёРЅСЃС‚РІРµРЅРЅРѕРіРѕ РІР»Р°РґРµР»СЊС†Р°" });
      }

      await storage.updateWorkspaceMemberRole(workspaceId, target.user.id, payload.role);
      const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
      res.json({ members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }
      next(error);
    }
  });

  app.delete("/api/workspaces/members/:memberId", async (req, res, next) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const memberId = req.params.memberId;
      if (memberId === user.id) {
        return res.status(400).json({ message: "РќРµР»СЊР·СЏ СѓРґР°Р»РёС‚СЊ СЃР°РјРѕРіРѕ СЃРµР±СЏ РёР· СЂР°Р±РѕС‡РµРіРѕ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІР°" });
      }

      const { id: workspaceId } = getRequestWorkspace(req);
      const members = await storage.listWorkspaceMembers(workspaceId);
      const target = members.find((entry) => entry.user.id === memberId);
      if (!target) {
        return res.status(404).json({ message: "РЈС‡Р°СЃС‚РЅРёРє РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const ownerCount = members.filter((entry) => entry.member.role === "owner").length;
      if (target.member.role === "owner" && ownerCount <= 1) {
        return res.status(400).json({ message: "РќРµР»СЊР·СЏ СѓРґР°Р»РёС‚СЊ РµРґРёРЅСЃС‚РІРµРЅРЅРѕРіРѕ РІР»Р°РґРµР»СЊС†Р°" });
      }

      const removed = await storage.removeWorkspaceMember(workspaceId, memberId);
      if (!removed) {
        return res.status(404).json({ message: "РЈС‡Р°СЃС‚РЅРёРє РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
      res.json({ members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users/me", async (req, res, next) => {
    try {
      const sessionUser = getAuthorizedUser(req, res);
      if (!sessionUser) {
        return;
      }

      const freshUser = await storage.getUser(sessionUser.id);
      const safeUser = freshUser ? toPublicUser(freshUser) : sessionUser;
      if (freshUser) {
        req.user = safeUser;
      }

      res.json({ user: safeUser });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/me", async (req, res, next) => {
    try {
      const sessionUser = getAuthorizedUser(req, res);
      if (!sessionUser) {
        return;
      }

      const parsed = updateProfileSchema.parse(req.body);
      const firstName = parsed.firstName.trim();
      const lastName = parsed.lastName?.trim() ?? "";
      const phone = parsed.phone?.trim() ?? "";
      const fullName = [firstName, lastName].filter((part) => part.length > 0).join(" ");

      const updatedUser = await storage.updateUserProfile(sessionUser.id, {
        firstName,
        lastName,
        phone,
        fullName: fullName.length > 0 ? fullName : firstName,
      });

      const refreshedUser = updatedUser ?? (await storage.getUser(sessionUser.id));
      const safeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;

      req.logIn(safeUser, (error) => {
        if (error) {
          return next(error);
        }

        res.json({ user: safeUser });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  const changePasswordSchema = z
    .object({
      currentPassword: z
        .string()
        .min(8, "РњРёРЅРёРјР°Р»СЊРЅР°СЏ РґР»РёРЅР° РїР°СЂРѕР»СЏ 8 СЃРёРјРІРѕР»РѕРІ")
        .max(100, "РЎР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№ РїР°СЂРѕР»СЊ"),
      newPassword: z
        .string()
        .min(8, "РњРёРЅРёРјР°Р»СЊРЅР°СЏ РґР»РёРЅР° РїР°СЂРѕР»СЏ 8 СЃРёРјРІРѕР»РѕРІ")
        .max(100, "РЎР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№ РїР°СЂРѕР»СЊ"),
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: "РќРѕРІС‹Р№ РїР°СЂРѕР»СЊ РґРѕР»Р¶РµРЅ РѕС‚Р»РёС‡Р°С‚СЊСЃСЏ РѕС‚ С‚РµРєСѓС‰РµРіРѕ",
      path: ["newPassword"],
    });

  app.post("/api/users/me/password", async (req, res, next) => {
    try {
      const sessionUser = getAuthorizedUser(req, res);
      if (!sessionUser) {
        return;
      }

      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const fullUser = await storage.getUser(sessionUser.id);

      if (!fullUser) {
        return res.status(404).json({ message: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!fullUser.passwordHash) {
        return res.status(400).json({
          message: "РЎРјРµРЅР° РїР°СЂРѕР»СЏ РЅРµРґРѕСЃС‚СѓРїРЅР° РґР»СЏ Р°РєРєР°СѓРЅС‚Р° СЃ РІС…РѕРґРѕРј С‡РµСЂРµР· Google",
        });
      }

      const isValid = await bcrypt.compare(currentPassword, fullUser.passwordHash);
      if (!isValid) {
        return res.status(400).json({ message: "РўРµРєСѓС‰РёР№ РїР°СЂРѕР»СЊ СѓРєР°Р·Р°РЅ РЅРµРІРµСЂРЅРѕ" });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);
      const updatedUser = await storage.updateUserPassword(sessionUser.id, newPasswordHash);
      const safeUser = toPublicUser(updatedUser ?? fullUser);

      req.logIn(safeUser, (error) => {
        if (error) {
          return next(error);
        }

        res.json({ user: safeUser });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  const issuePersonalTokenHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionUser = getAuthorizedUser(req, res);
      if (!sessionUser) {
        return;
      }

      const tokenBuffer = randomBytes(32);
      const token = tokenBuffer.toString("hex");
      const hash = createHash("sha256").update(token).digest("hex");
      const lastFour = token.slice(-4);

      await storage.createUserPersonalApiToken(sessionUser.id, { hash, lastFour });

      const { tokens, activeTokens, latestActive } = await loadTokensAndSyncUser(sessionUser.id);
      const refreshedUser = await storage.getUser(sessionUser.id);
      const baseSafeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;
      const safeUser: PublicUser = {
        ...baseSafeUser,
        hasPersonalApiToken: activeTokens.length > 0,
        personalApiTokenLastFour: latestActive ? latestActive.lastFour : null,
        personalApiTokenGeneratedAt: latestActive ? latestActive.createdAt : null,
      };

      req.logIn(safeUser, (error) => {
        if (error) {
          return next(error);
        }

        res.json({
          token,
          user: safeUser,
          tokens: tokens.map(toPersonalApiTokenSummary),
        });
      });
    } catch (error) {
      next(error);
    }
  };

  app.get("/api/users/me/api-tokens", async (req, res, next) => {
    try {
      const sessionUser = getAuthorizedUser(req, res);
      if (!sessionUser) {
        return;
      }

      const tokens = await storage.listUserPersonalApiTokens(sessionUser.id);
      res.json({ tokens: tokens.map(toPersonalApiTokenSummary) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users/me/api-tokens", issuePersonalTokenHandler);
  app.post("/api/users/me/api-token", issuePersonalTokenHandler);

  app.post("/api/users/me/api-tokens/:tokenId/revoke", async (req, res, next) => {
    try {
      const sessionUser = getAuthorizedUser(req, res);
      if (!sessionUser) {
        return;
      }

      const { tokenId } = req.params;
      if (!tokenId) {
        return res.status(400).json({ message: "РќРµ СѓРєР°Р·Р°РЅ С‚РѕРєРµРЅ" });
      }

      const revokedToken = await storage.revokeUserPersonalApiToken(sessionUser.id, tokenId);
      if (!revokedToken) {
        return res.status(404).json({ message: "РўРѕРєРµРЅ РЅРµ РЅР°Р№РґРµРЅ РёР»Рё СѓР¶Рµ РѕС‚РѕР·РІР°РЅ" });
      }

      const { tokens, activeTokens, latestActive } = await loadTokensAndSyncUser(sessionUser.id);
      const refreshedUser = await storage.getUser(sessionUser.id);
      const baseSafeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;
      const safeUser: PublicUser = {
        ...baseSafeUser,
        hasPersonalApiToken: activeTokens.length > 0,
        personalApiTokenLastFour: latestActive ? latestActive.lastFour : null,
        personalApiTokenGeneratedAt: latestActive ? latestActive.createdAt : null,
      };

      req.logIn(safeUser, (error) => {
        if (error) {
          return next(error);
        }

        res.json({
          user: safeUser,
          tokens: tokens.map(toPersonalApiTokenSummary),
        });
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/workspaces", requireAdmin, async (_req, res, next) => {
    try {
      const workspaces = await storage.listAllWorkspacesWithStats();
      res.json({
        workspaces: workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          usersCount: workspace.usersCount,
          managerFullName: workspace.managerFullName,
          createdAt: workspace.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/users", requireAdmin, async (_req, res, next) => {
    try {
      const users = await storage.listUsers();
      res.json({ users: users.map((user) => toPublicUser(user)) });
    } catch (error) {
      next(error);
    }
  });

  const updateUserRoleSchema = z.object({
    role: z.enum(userRoles),
  });

  app.patch("/api/admin/users/:userId/role", requireAdmin, async (req, res, next) => {
    try {
      const { role } = updateUserRoleSchema.parse(req.body);
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({ message: "РќРµ СѓРєР°Р·Р°РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ" });
      }

      const updatedUser = await storage.updateUserRole(userId, role);
      if (!updatedUser) {
        return res.status(404).json({ message: "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      res.json({ user: toPublicUser(updatedUser) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  app.get("/api/admin/auth/providers/google", requireAdmin, async (_req, res, next) => {
    try {
      const provider = await storage.getAuthProvider("google");
      const envClientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
      const envClientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
      const envCallbackUrl = (process.env.GOOGLE_CALLBACK_URL ?? "/api/auth/google/callback").trim();

      if (provider) {
        const clientId = provider.clientId?.trim() ?? "";
        const callbackUrl = provider.callbackUrl?.trim() || envCallbackUrl;
        const hasSecret = Boolean(provider.clientSecret && provider.clientSecret.trim().length > 0);
        const isEnabled = provider.isEnabled && clientId.length > 0 && hasSecret;

        res.json({
          provider: "google",
          clientId,
          callbackUrl,
          isEnabled,
          hasClientSecret: hasSecret,
          source: "database" as const,
        });
        return;
      }

      res.json({
        provider: "google",
        clientId: envClientId,
        callbackUrl: envCallbackUrl,
        isEnabled: envClientId.length > 0 && envClientSecret.length > 0,
        hasClientSecret: envClientSecret.length > 0,
        source: "environment" as const,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/auth/providers/google", requireAdmin, async (req, res, next) => {
    try {
      const payload = upsertAuthProviderSchema.parse(req.body);
      if (payload.provider !== "google") {
        return res.status(400).json({ error: "РџРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РїСЂРѕРІР°Р№РґРµСЂ Google" });
      }

      const trimmedClientId = payload.clientId.trim();
      const trimmedCallbackUrl = payload.callbackUrl.trim();
      const trimmedClientSecret =
        payload.clientSecret !== undefined ? payload.clientSecret.trim() : undefined;

      const existing = await storage.getAuthProvider("google");
      const hasStoredSecret = Boolean(existing?.clientSecret && existing.clientSecret.trim().length > 0);

      if (payload.isEnabled) {
        if (trimmedClientId.length === 0) {
          return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ Client ID" });
        }

        const secretCandidate = trimmedClientSecret ?? "";
        if (secretCandidate.length === 0 && !hasStoredSecret) {
          return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ Client Secret" });
        }
      }

      const updates = {
        isEnabled: payload.isEnabled,
        clientId: trimmedClientId,
        callbackUrl: trimmedCallbackUrl,
        clientSecret:
          payload.clientSecret !== undefined ? trimmedClientSecret ?? "" : undefined,
      } satisfies Partial<AuthProviderInsert>;

      const updated = await storage.upsertAuthProvider("google", updates);

      try {
        await reloadGoogleAuth(app);
      } catch (error) {
        console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РѕР±РЅРѕРІР»С‘РЅРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё Google OAuth:", error);
      }

      const clientId = updated.clientId?.trim() ?? "";
      const hasClientSecret = Boolean(updated.clientSecret && updated.clientSecret.trim().length > 0);
      const callbackUrl = updated.callbackUrl?.trim() || trimmedCallbackUrl || "/api/auth/google/callback";
      const isEnabled = updated.isEnabled && clientId.length > 0 && hasClientSecret;

      res.json({
        provider: "google",
        clientId,
        callbackUrl,
        isEnabled,
        hasClientSecret,
        source: "database" as const,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/auth/providers/yandex", requireAdmin, async (_req, res, next) => {
    try {
      const provider = await storage.getAuthProvider("yandex");
      const envClientId = (process.env.YANDEX_CLIENT_ID ?? "").trim();
      const envClientSecret = (process.env.YANDEX_CLIENT_SECRET ?? "").trim();
      const envCallbackUrl = (process.env.YANDEX_CALLBACK_URL ?? "/api/auth/yandex/callback").trim();

      if (provider) {
        const clientId = provider.clientId?.trim() ?? "";
        const callbackUrl = provider.callbackUrl?.trim() || envCallbackUrl;
        const hasSecret = Boolean(provider.clientSecret && provider.clientSecret.trim().length > 0);
        const isEnabled = provider.isEnabled && clientId.length > 0 && hasSecret;

        res.json({
          provider: "yandex",
          clientId,
          callbackUrl,
          isEnabled,
          hasClientSecret: hasSecret,
          source: "database" as const,
        });
        return;
      }

      res.json({
        provider: "yandex",
        clientId: envClientId,
        callbackUrl: envCallbackUrl,
        isEnabled: envClientId.length > 0 && envClientSecret.length > 0,
        hasClientSecret: envClientSecret.length > 0,
        source: "environment" as const,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/auth/providers/yandex", requireAdmin, async (req, res, next) => {
    try {
      const payload = upsertAuthProviderSchema.parse(req.body);
      if (payload.provider !== "yandex") {
        return res.status(400).json({ error: "РџРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РїСЂРѕРІР°Р№РґРµСЂ Yandex" });
      }

      const trimmedClientId = payload.clientId.trim();
      const trimmedCallbackUrl = payload.callbackUrl.trim();
      const trimmedClientSecret =
        payload.clientSecret !== undefined ? payload.clientSecret.trim() : undefined;

      const existing = await storage.getAuthProvider("yandex");
      const hasStoredSecret = Boolean(existing?.clientSecret && existing.clientSecret.trim().length > 0);

      if (payload.isEnabled) {
        if (trimmedClientId.length === 0) {
          return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ Client ID" });
        }

        const secretCandidate = trimmedClientSecret ?? "";
        if (secretCandidate.length === 0 && !hasStoredSecret) {
          return res.status(400).json({ error: "РЈРєР°Р¶РёС‚Рµ Client Secret" });
        }
      }

      const updates = {
        isEnabled: payload.isEnabled,
        clientId: trimmedClientId,
        callbackUrl: trimmedCallbackUrl,
        clientSecret:
          payload.clientSecret !== undefined ? trimmedClientSecret ?? "" : undefined,
      } satisfies Partial<AuthProviderInsert>;

      const updated = await storage.upsertAuthProvider("yandex", updates);

      try {
        await reloadYandexAuth(app);
      } catch (error) {
        console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РѕР±РЅРѕРІР»С‘РЅРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё Yandex OAuth:", error);
      }

      const clientId = updated.clientId?.trim() ?? "";
      const hasClientSecret = Boolean(updated.clientSecret && updated.clientSecret.trim().length > 0);
      const callbackUrl = updated.callbackUrl?.trim() || trimmedCallbackUrl || "/api/auth/yandex/callback";
      const isEnabled = updated.isEnabled && clientId.length > 0 && hasClientSecret;

      res.json({
        provider: "yandex",
        clientId,
        callbackUrl,
        isEnabled,
        hasClientSecret,
        source: "database" as const,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/embedding/services", requireAdmin, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const providers = await storage.listEmbeddingProviders(workspaceId);
      res.json({ providers: providers.map(toPublicEmbeddingProvider) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/embedding/services", requireAdmin, async (req, res) => {
    try {
      const payload = insertEmbeddingProviderSchema.parse(req.body);
      const normalizedQdrantConfig =
        payload.providerType === "gigachat"
          ? (() => {
              const baseConfig =
                payload.qdrantConfig && typeof payload.qdrantConfig === "object"
                  ? { ...payload.qdrantConfig }
                  : { ...DEFAULT_QDRANT_CONFIG };
              const normalizedSize = parseVectorSize(baseConfig.vectorSize);

              return {
                ...baseConfig,
                vectorSize: normalizedSize ?? GIGACHAT_EMBEDDING_VECTOR_SIZE,
              };
            })()
          : payload.qdrantConfig;
      const { id: workspaceId } = getRequestWorkspace(req);
      const provider = await storage.createEmbeddingProvider({
        ...payload,
        workspaceId,
        description: payload.description ?? null,
        qdrantConfig: normalizedQdrantConfig,
      });

      const rawCollectionName =
        typeof normalizedQdrantConfig?.collectionName === "string"
          ? normalizedQdrantConfig.collectionName.trim()
          : "";

      if (rawCollectionName && rawCollectionName.toLowerCase() !== "auto") {
        try {
          await storage.upsertCollectionWorkspace(rawCollectionName, workspaceId);
        } catch (mappingError) {
          console.error(
            `РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРІСЏР·Р°С‚СЊ РєРѕР»Р»РµРєС†РёСЋ ${rawCollectionName} Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ ${workspaceId} РїСЂРё СЃРѕР·РґР°РЅРёРё СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ`,
            mappingError,
          );
          return res.status(500).json({
            message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРІСЏР·Р°С‚СЊ РєРѕР»Р»РµРєС†РёСЋ Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ",
          });
        }
      }

      res.status(201).json({ provider: toPublicEmbeddingProvider(provider) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      const errorDetails = getErrorDetails(error);
      console.error(
        `[Embedding Services] РћС€РёР±РєР° РїСЂРё СЃРѕР·РґР°РЅРёРё СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ: ${errorDetails}`,
        error,
      );

      return res.status(500).json({
        message: "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ",
        details: errorDetails,
      });
    }
  });

  app.post("/api/embedding/services/test-credentials", requireAdmin, async (req, res, next) => {
    try {
      const payload = testEmbeddingCredentialsSchema.parse(req.body);

      type CredentialDebugStage =
        | "token-request"
        | "token-response"
        | "embedding-request"
        | "embedding-response";

      type CredentialDebugStep = {
        stage: CredentialDebugStage;
        status: "success" | "error";
        detail: string;
      };

      const debugSteps: CredentialDebugStep[] = [];

      const respondWithError = (status: number, message: string) => {
        return res.status(status).json({ message, steps: debugSteps });
      };

      const tokenHeaders = new Headers();
      const rawAuthorizationKey = payload.authorizationKey.trim();
      const hasAuthScheme = /^(?:[A-Za-z]+)\s+\S+/.test(rawAuthorizationKey);
      const authorizationHeader = hasAuthScheme
        ? rawAuthorizationKey
        : `Basic ${rawAuthorizationKey}`;
      tokenHeaders.set("Authorization", authorizationHeader);
      tokenHeaders.set("Content-Type", "application/x-www-form-urlencoded");
      tokenHeaders.set("Accept", "application/json");

      if (!tokenHeaders.has("RqUID")) {
        tokenHeaders.set("RqUID", randomUUID());
      }

      for (const [key, value] of Object.entries(payload.requestHeaders)) {
        tokenHeaders.set(key, value);
      }

      let tokenResponse: FetchResponse;
      try {
        const tokenRequestBody = new URLSearchParams({
          scope: payload.scope,
          grant_type: "client_credentials",
        }).toString();

        const tokenRequestOptions = applyTlsPreferences<NodeFetchOptions>(
          {
            method: "POST",
            headers: tokenHeaders,
            body: tokenRequestBody,
          },
          payload.allowSelfSignedCertificate,
        );
        tokenResponse = await fetch(payload.tokenUrl, tokenRequestOptions);
        debugSteps.push({
          stage: "token-request",
          status: "success",
          detail: `POST ${payload.tokenUrl} (scope: ${payload.scope})`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const details = errorMessage ? `: ${errorMessage}` : "";
        if (
          !payload.allowSelfSignedCertificate &&
          details.includes("self-signed certificate")
        ) {
          const message =
            "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ Рє СЃРµСЂРІРёСЃСѓ СЌРјР±РµРґРґРёРЅРіРѕРІ: СЃРµСЂС‚РёС„РёРєР°С‚ РЅРµ РїСЂРѕС€С‘Р» РїСЂРѕРІРµСЂРєСѓ. Р’РєР»СЋС‡РёС‚Рµ РѕРїС†РёСЋ РґРѕРІРµСЂРёСЏ СЃР°РјРѕРїРѕРґРїРёСЃР°РЅРЅС‹Рј СЃРµСЂС‚РёС„РёРєР°С‚Р°Рј Рё РїРѕРІС‚РѕСЂРёС‚Рµ РїРѕРїС‹С‚РєСѓ.";
          debugSteps.push({
            stage: "token-request",
            status: "error",
            detail: message,
          });
          return respondWithError(502, message);
        }
        const message = `РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ Рє СЃРµСЂРІРёСЃСѓ СЌРјР±РµРґРґРёРЅРіРѕРІ${details}`;
        debugSteps.push({
          stage: "token-request",
          status: "error",
          detail: message,
        });
        return respondWithError(502, message);
      }

      const rawBody = await tokenResponse.text();
      const parsedBody = parseJson(rawBody);

      if (!tokenResponse.ok) {
        let message = `РЎРµСЂРІРёСЃ РІРµСЂРЅСѓР» СЃС‚Р°С‚СѓСЃ ${tokenResponse.status}`;

        if (parsedBody && typeof parsedBody === "object") {
          const body = parsedBody as Record<string, unknown>;
          if (typeof body.error_description === "string") {
            message = body.error_description;
          } else if (typeof body.message === "string") {
            message = body.message;
          }
        } else if (typeof parsedBody === "string" && parsedBody.trim()) {
          message = parsedBody.trim();
        }

        debugSteps.push({
          stage: "token-response",
          status: "error",
          detail: message,
        });
        return respondWithError(400, `РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°: ${message}`);
      }

      const messageParts = ["РЎРѕРµРґРёРЅРµРЅРёРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅРѕ."];

      if (payload.allowSelfSignedCertificate) {
        messageParts.push("РџСЂРѕРІРµСЂРєР° СЃРµСЂС‚РёС„РёРєР°С‚Р° РѕС‚РєР»СЋС‡РµРЅР°.");
      }

      let accessToken: string | undefined;
      if (parsedBody && typeof parsedBody === "object") {
        const body = parsedBody as Record<string, unknown>;

        if (typeof body.access_token === "string" && body.access_token.trim()) {
          accessToken = body.access_token;
          messageParts.push("РџРѕР»СѓС‡РµРЅ access_token.");
          debugSteps.push({
            stage: "token-response",
            status: "success",
            detail: `РЎС‚Р°С‚СѓСЃ ${tokenResponse.status}. РџРѕР»СѓС‡РµРЅ access_token.`,
          });
        }

        if (typeof body.expires_in === "number") {
          messageParts.push(`Р”РµР№СЃС‚РІСѓРµС‚ ${body.expires_in} СЃ.`);
        }

        if (typeof body.expires_at === "string") {
          messageParts.push(`РСЃС‚РµРєР°РµС‚ ${body.expires_at}.`);
        }
      } else if (typeof parsedBody === "string" && parsedBody.trim()) {
        messageParts.push(parsedBody.trim());
      }

      if (!accessToken) {
        const message = "РЎРµСЂРІРёСЃ РЅРµ РІРµСЂРЅСѓР» access_token";
        debugSteps.push({
          stage: "token-response",
          status: "error",
          detail: message,
        });
        return respondWithError(400, `РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РїРѕР»СѓС‡РµРЅРёСЏ С‚РѕРєРµРЅР°: ${message}`);
      }

      const embeddingHeaders = new Headers();
      embeddingHeaders.set("Content-Type", "application/json");
      embeddingHeaders.set("Accept", "application/json");

      for (const [key, value] of Object.entries(payload.requestHeaders)) {
        embeddingHeaders.set(key, value);
      }

      if (!embeddingHeaders.has("Authorization")) {
        embeddingHeaders.set("Authorization", `Bearer ${accessToken}`);
      }

      const embeddingBody = createEmbeddingRequestBody(payload.model, TEST_EMBEDDING_TEXT);

      let embeddingResponse: FetchResponse;
      try {
        const embeddingRequestOptions = applyTlsPreferences<NodeFetchOptions>(
          {
            method: "POST",
            headers: embeddingHeaders,
            body: JSON.stringify(embeddingBody),
          },
          payload.allowSelfSignedCertificate,
        );
        embeddingResponse = await fetch(payload.embeddingsUrl, embeddingRequestOptions);
        debugSteps.push({
          stage: "embedding-request",
          status: "success",
          detail: `POST ${payload.embeddingsUrl} (model: ${payload.model})`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const details = errorMessage ? `: ${errorMessage}` : "";
        const message = `РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ Р·Р°РїСЂРѕСЃ Рє СЃРµСЂРІРёСЃСѓ СЌРјР±РµРґРґРёРЅРіРѕРІ${details}`;
        debugSteps.push({
          stage: "embedding-request",
          status: "error",
          detail: message,
        });
        return respondWithError(502, message);
      }

      const embeddingsRawBody = await embeddingResponse.text();
      const embeddingsParsedBody = parseJson(embeddingsRawBody);

      if (!embeddingResponse.ok) {
        let message = `РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» СЃС‚Р°С‚СѓСЃ ${embeddingResponse.status}`;

        if (embeddingsParsedBody && typeof embeddingsParsedBody === "object") {
          const body = embeddingsParsedBody as Record<string, unknown>;
          if (typeof body.error_description === "string") {
            message = body.error_description;
          } else if (typeof body.message === "string") {
            message = body.message;
          }
        } else if (typeof embeddingsParsedBody === "string" && embeddingsParsedBody.trim()) {
          message = embeddingsParsedBody.trim();
        }

        debugSteps.push({
          stage: "embedding-response",
          status: "error",
          detail: message,
        });
        return respondWithError(400, `РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РїРѕР»СѓС‡РµРЅРёСЏ РІРµРєС‚РѕСЂР°: ${message}`);
      }

      let vectorLength = 0;
      let usageTokens: number | undefined;

      try {
        const extractionResult = extractEmbeddingResponse(embeddingsParsedBody);
        vectorLength = extractionResult.vector.length;
        usageTokens = extractionResult.usageTokens;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РѕС‚РІРµС‚ СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ";
        debugSteps.push({
          stage: "embedding-response",
          status: "error",
          detail: message,
        });
        return respondWithError(400, `РћС€РёР±РєР° РЅР° СЌС‚Р°РїРµ РїРѕР»СѓС‡РµРЅРёСЏ РІРµРєС‚РѕСЂР°: ${message}`);
      }

      messageParts.push(`РџРѕР»СѓС‡РµРЅ РІРµРєС‚РѕСЂ РґР»РёРЅРѕР№ ${vectorLength}.`);
      debugSteps.push({
        stage: "embedding-response",
        status: "success",
        detail: `РЎС‚Р°С‚СѓСЃ ${embeddingResponse.status}. Р’РµРєС‚РѕСЂ РґР»РёРЅРѕР№ ${vectorLength}.`,
      });

      if (usageTokens !== undefined) {
        messageParts.push(`РР·СЂР°СЃС…РѕРґРѕРІР°РЅРѕ ${usageTokens} С‚РѕРєРµРЅРѕРІ.`);
      }

      res.json({ message: messageParts.join(" "), steps: debugSteps });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  app.put("/api/embedding/services/:id", requireAdmin, async (req, res, next) => {
    try {
      const providerId = req.params.id;
      const payload = updateEmbeddingProviderSchema.parse(req.body);

      const { id: workspaceId } = getRequestWorkspace(req);
      const existingProvider = await storage.getEmbeddingProvider(providerId, workspaceId);
      if (!existingProvider) {
        return res.status(404).json({ message: "РЎРµСЂРІРёСЃ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const updates: Partial<EmbeddingProvider> = {};

      if (payload.name !== undefined) updates.name = payload.name;
      if (payload.providerType !== undefined) updates.providerType = payload.providerType;
      if (payload.description !== undefined) updates.description = payload.description ?? null;
      if (payload.isActive !== undefined) updates.isActive = payload.isActive;
      if (payload.tokenUrl !== undefined) updates.tokenUrl = payload.tokenUrl;
      if (payload.embeddingsUrl !== undefined) updates.embeddingsUrl = payload.embeddingsUrl;
      if (payload.authorizationKey !== undefined) updates.authorizationKey = payload.authorizationKey;
      if (payload.scope !== undefined) updates.scope = payload.scope;
      if (payload.model !== undefined) updates.model = payload.model;
      if (payload.maxTokensPerVectorization !== undefined)
        updates.maxTokensPerVectorization = payload.maxTokensPerVectorization;
      if (payload.requestHeaders !== undefined) updates.requestHeaders = payload.requestHeaders;
      if (payload.allowSelfSignedCertificate !== undefined)
        updates.allowSelfSignedCertificate = payload.allowSelfSignedCertificate;

      if (payload.qdrantConfig !== undefined) {
        const targetProviderType = updates.providerType ?? existingProvider.providerType;
        const currentConfig =
          existingProvider.qdrantConfig &&
          typeof existingProvider.qdrantConfig === "object" &&
          !Array.isArray(existingProvider.qdrantConfig)
            ? { ...(existingProvider.qdrantConfig as Record<string, unknown>) }
            : {};
        const incomingConfig =
          payload.qdrantConfig && typeof payload.qdrantConfig === "object" && !Array.isArray(payload.qdrantConfig)
            ? { ...(payload.qdrantConfig as Record<string, unknown>) }
            : {};
        const mergedConfig = removeUndefinedDeep({ ...currentConfig, ...incomingConfig });

        if (targetProviderType === "gigachat") {
          const baseConfig = Object.keys(mergedConfig).length > 0 ? mergedConfig : { ...DEFAULT_QDRANT_CONFIG };
          const normalizedSize = parseVectorSize(baseConfig.vectorSize);
          updates.qdrantConfig = {
            ...baseConfig,
            vectorSize: normalizedSize ?? GIGACHAT_EMBEDDING_VECTOR_SIZE,
          } as EmbeddingProvider["qdrantConfig"];
        } else {
          updates.qdrantConfig = mergedConfig as EmbeddingProvider["qdrantConfig"];
        }
      }

      const updated = await storage.updateEmbeddingProvider(providerId, updates, workspaceId);
      if (!updated) {
        return res.status(404).json({ message: "РЎРµСЂРІРёСЃ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      const rawCollectionName =
        typeof updated.qdrantConfig?.collectionName === "string"
          ? updated.qdrantConfig.collectionName.trim()
          : "";

      if (rawCollectionName && rawCollectionName.toLowerCase() !== "auto") {
        try {
          await storage.upsertCollectionWorkspace(rawCollectionName, workspaceId);
        } catch (mappingError) {
          console.error(
            `РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРІСЏР·Р°С‚СЊ РєРѕР»Р»РµРєС†РёСЋ ${rawCollectionName} Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ ${workspaceId} РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё СЃРµСЂРІРёСЃР° СЌРјР±РµРґРґРёРЅРіРѕРІ`,
            mappingError,
          );
          return res.status(500).json({
            message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРІСЏР·Р°С‚СЊ РєРѕР»Р»РµРєС†РёСЋ Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ",
          });
        }
      }

      res.json({ provider: toPublicEmbeddingProvider(updated) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  app.delete("/api/embedding/services/:id", requireAdmin, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const deleted = await storage.deleteEmbeddingProvider(req.params.id, workspaceId);
      if (!deleted) {
        return res.status(404).json({ message: "РЎРµСЂРІРёСЃ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/llm/providers", requireAdmin, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const providers = await storage.listLlmProviders(workspaceId);
      res.json({ providers: providers.map(toPublicLlmProvider) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/llm/providers", requireAdmin, async (req, res) => {
    try {
      const payload = insertLlmProviderSchema.parse(req.body);
      const { id: workspaceId } = getRequestWorkspace(req);
      const provider = await storage.createLlmProvider({
        ...payload,
        workspaceId,
        description: payload.description ?? null,
        requestConfig: payload.requestConfig ?? { ...DEFAULT_LLM_REQUEST_CONFIG },
        responseConfig: payload.responseConfig ?? { ...DEFAULT_LLM_RESPONSE_CONFIG },
        availableModels: payload.availableModels ?? [],
      });

      res.status(201).json({ provider: toPublicLlmProvider(provider) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      const errorDetails = getErrorDetails(error);
      console.error(`[LLM Providers] РћС€РёР±РєР° РїСЂРё СЃРѕР·РґР°РЅРёРё РїСЂРѕРІР°Р№РґРµСЂР°: ${errorDetails}`, error);
      return res.status(500).json({
        message: "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РїСЂРѕРІР°Р№РґРµСЂР° LLM",
        details: errorDetails,
      });
    }
  });

  app.put("/api/llm/providers/:id", requireAdmin, async (req, res, next) => {
    try {
      const providerId = req.params.id;
      const payload = updateLlmProviderSchema.parse(req.body);

      const updates: Partial<LlmProvider> & { availableModels?: LlmModelOption[] } = {};

      if (payload.name !== undefined) updates.name = payload.name;
      if (payload.providerType !== undefined) updates.providerType = payload.providerType;
      if (payload.description !== undefined) updates.description = payload.description ?? null;
      if (payload.isActive !== undefined) updates.isActive = payload.isActive;
      if (payload.tokenUrl !== undefined) updates.tokenUrl = payload.tokenUrl;
      if (payload.completionUrl !== undefined) updates.completionUrl = payload.completionUrl;
      if (payload.authorizationKey !== undefined) updates.authorizationKey = payload.authorizationKey;
      if (payload.scope !== undefined) updates.scope = payload.scope;
      if (payload.model !== undefined) updates.model = payload.model;
      if (payload.requestHeaders !== undefined) updates.requestHeaders = payload.requestHeaders;
      if (payload.allowSelfSignedCertificate !== undefined)
        updates.allowSelfSignedCertificate = payload.allowSelfSignedCertificate;
      if (payload.availableModels !== undefined) {
        updates.availableModels = payload.availableModels;
      }
      if (payload.requestConfig !== undefined)
        updates.requestConfig = {
          ...DEFAULT_LLM_REQUEST_CONFIG,
          ...(payload.requestConfig as Record<string, unknown>),
        } as LlmProvider["requestConfig"];
      if (payload.responseConfig !== undefined)
        updates.responseConfig = {
          ...DEFAULT_LLM_RESPONSE_CONFIG,
          ...(payload.responseConfig as Record<string, unknown>),
        } as LlmProvider["responseConfig"];

      const { id: workspaceId } = getRequestWorkspace(req);
      const updated = await storage.updateLlmProvider(providerId, updates, workspaceId);
      if (!updated) {
        return res.status(404).json({ message: "РџСЂРѕРІР°Р№РґРµСЂ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      res.json({ provider: toPublicLlmProvider(updated) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      next(error);
    }
  });

  app.delete("/api/llm/providers/:id", requireAdmin, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const deleted = await storage.deleteLlmProvider(req.params.id, workspaceId);
      if (!deleted) {
        return res.status(404).json({ message: "РџСЂРѕРІР°Р№РґРµСЂ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Vector search endpoints
  const qdrantCollectionsResponseSchema = z
    .object({
      collections: z
        .array(
          z.object({
            name: z.string().min(1),
          }),
        )
        .optional(),
    })
    .strict();

  app.get("/api/vector/collections", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const allowedCollections = await storage.listWorkspaceCollections(workspaceId);

      if (allowedCollections.length === 0) {
        return res.json({ collections: [] });
      }

      const allowedSet = new Set(allowedCollections);
      const client = getQdrantClient();
      const collectionsResponse = await client.getCollections();
      const parsedCollections = qdrantCollectionsResponseSchema.safeParse(collectionsResponse);

      if (!parsedCollections.success) {
        console.warn(
          "РќРµРѕР¶РёРґР°РЅРЅС‹Р№ С„РѕСЂРјР°С‚ РѕС‚РІРµС‚Р° Qdrant РїСЂРё Р·Р°РїСЂРѕСЃРµ СЃРїРёСЃРєР° РєРѕР»Р»РµРєС†РёР№:",
          parsedCollections.error.flatten(),
        );
      }

      const collections = parsedCollections.success
        ? parsedCollections.data.collections ?? []
        : [];

      const detailedCollections = await Promise.all(
        collections.map(async ({ name }) => {
          if (!allowedSet.has(name)) {
            return null;
          }

          try {
            const info = await client.getCollection(name);
            const vectorsConfig = info.config?.params?.vectors as
              | { size?: number | null; distance?: string | null }
              | undefined;

            return {
              name,
              status: info.status,
              optimizerStatus: info.optimizer_status,
              pointsCount: info.points_count ?? info.vectors_count ?? 0,
              vectorsCount: info.vectors_count ?? null,
              vectorSize: vectorsConfig?.size ?? null,
              distance: vectorsConfig?.distance ?? null,
              segmentsCount: info.segments_count,
            };
          } catch (error) {
            return {
              name,
              status: "unknown" as const,
              error: error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃРІРµРґРµРЅРёСЏ Рѕ РєРѕР»Р»РµРєС†РёРё",
            };
          }
        })
      );

      const existingCollections = detailedCollections.filter(
        (collection): collection is NonNullable<typeof collection> => collection !== null,
      );
      const existingNames = new Set(existingCollections.map((collection) => collection.name));
      const missingCollections = allowedCollections
        .filter((name) => !existingNames.has(name))
        .map((name) => ({
          name,
          status: "unknown" as const,
          optimizerStatus: "unknown" as const,
          pointsCount: 0,
          vectorsCount: null,
          vectorSize: null,
          distance: null,
          segmentsCount: null,
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР° РІ Qdrant",
        }));

      res.json({ collections: [...existingCollections, ...missingCollections] });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("РћС€РёР±РєР° Qdrant РїСЂРё РїРѕР»СѓС‡РµРЅРёРё СЃРїРёСЃРєР° РєРѕР»Р»РµРєС†РёР№:", error);

        const responseBody: Record<string, unknown> = {
          error: "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїРёСЃРѕРє РєРѕР»Р»РµРєС†РёР№",
          details: qdrantError.message,
        };

        if (typeof qdrantError.details === "object" && qdrantError.details !== null) {
          responseBody.qdrantDetails = qdrantError.details;
        } else if (typeof qdrantError.details === "string") {
          const trimmed = qdrantError.details.trim();

          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
              responseBody.qdrantDetails = JSON.parse(trimmed);
            } catch {
              // Р•СЃР»Рё СЃС‚СЂРѕРєР° РїРѕС…РѕР¶Р° РЅР° JSON, РЅРѕ РїР°СЂСЃРёРЅРі РЅРµ СѓРґР°Р»СЃСЏ, РїСЂРѕСЃС‚Рѕ РёРіРЅРѕСЂРёСЂСѓРµРј РµС‘
            }
          }
        }

        return res.status(qdrantError.status).json(responseBody);
      }

      const details = getErrorDetails(error);
      console.error("РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё РєРѕР»Р»РµРєС†РёР№ Qdrant:", error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїРёСЃРѕРє РєРѕР»Р»РµРєС†РёР№",
        details,
      });
    }
  });

  app.get("/api/vector/collections/:name", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const client = getQdrantClient();
      const info = await client.getCollection(req.params.name);
      const vectorsConfig = info.config?.params?.vectors as
        | { size?: number | null; distance?: string | null }
        | undefined;

      res.json({
        name: req.params.name,
        status: info.status,
        optimizerStatus: info.optimizer_status,
        pointsCount: info.points_count ?? info.vectors_count ?? 0,
        vectorsCount: info.vectors_count ?? null,
        segmentsCount: info.segments_count,
        vectorSize: vectorsConfig?.size ?? null,
        distance: vectorsConfig?.distance ?? null,
        config: info.config,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ РєРѕР»Р»РµРєС†РёРё",
        details,
      });
    }
  });

  app.get("/api/vector/collections/:name/points", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const limitParam = typeof req.query.limit === "string" ? req.query.limit.trim() : undefined;
      const limitNumber = limitParam ? Number.parseInt(limitParam, 10) : Number.NaN;
      const limit = Number.isFinite(limitNumber) && limitNumber > 0 ? Math.min(limitNumber, 100) : 20;

      const offsetParam = typeof req.query.offset === "string" ? req.query.offset.trim() : undefined;
      let offset: string | number | undefined;
      if (offsetParam) {
        if (/^-?\d+$/.test(offsetParam)) {
          offset = Number.parseInt(offsetParam, 10);
        } else {
          offset = offsetParam;
        }
      }

      const client = getQdrantClient();
      const result = await client.scroll(req.params.name, {
        limit,
        offset,
        with_payload: true,
        with_vector: true,
      });

      const points = result.points.map(({ vector, payload, ...rest }) => ({
        ...rest,
        vector: vector ?? null,
        payload: payload ?? null,
      }));

      res.json({
        points,
        nextPageOffset: result.next_page_offset ?? null,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё Р·Р°РїРёСЃРµР№ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ Р·Р°РїРёСЃРё РєРѕР»Р»РµРєС†РёРё",
        details,
      });
    }
  });

  app.post("/api/vector/collections/:name/scroll", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const body = scrollCollectionSchema.parse(req.body);
      const client = getQdrantClient();

      const scrollPayload: Record<string, unknown> = {
        limit: body.limit,
      };

      if (body.withPayload !== undefined) {
        scrollPayload["with_payload"] = body.withPayload;
      }

      if (body.withVector !== undefined) {
        scrollPayload["with_vector"] = body.withVector;
      }

      if (body.offset !== undefined) {
        scrollPayload["offset"] = body.offset;
      }

      if (body.filter !== undefined) {
        scrollPayload["filter"] = body.filter;
      }

      if (body.orderBy !== undefined) {
        scrollPayload["order_by"] = body.orderBy;
      }

      const result = await client.scroll(
        req.params.name,
        scrollPayload as Parameters<QdrantClient["scroll"]>[1],
      );

      const points = result.points.map(({ vector, payload, ...rest }) => ({
        ...rest,
        vector: vector ?? null,
        payload: payload ?? null,
      }));

      res.json({
        points,
        nextPageOffset: result.next_page_offset ?? null,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ С„РёР»СЊС‚СЂР°С†РёРё",
          details: error.errors,
        });
      }

      const details = getErrorDetails(error);
      console.error(`РћС€РёР±РєР° РїСЂРё С„РёР»СЊС‚СЂР°С†РёРё РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ С„РёР»СЊС‚СЂР°С†РёСЋ",
        details,
      });
    }
  });

  app.post("/api/vector/collections", async (req, res) => {
    try {
      const body = createVectorCollectionSchema.parse(req.body);
      const { id: workspaceId } = getRequestWorkspace(req);

      const existingWorkspaceId = await storage.getCollectionWorkspace(body.name);
      if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
        return res.status(409).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ СѓР¶Рµ РїСЂРёРЅР°РґР»РµР¶РёС‚ РґСЂСѓРіРѕРјСѓ СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ",
        });
      }

      const client = getQdrantClient();

      const { name, vectorSize, distance, onDiskPayload } = body;
      const result = await client.createCollection(name, {
        vectors: {
          size: vectorSize,
          distance,
        },
        on_disk_payload: onDiskPayload,
      });

      const info = await client.getCollection(name);
      await storage.upsertCollectionWorkspace(name, workspaceId);

      res.status(201).json({
        operation: result,
        collection: {
          name,
          status: info.status,
          optimizerStatus: info.optimizer_status,
          pointsCount: info.points_count ?? info.vectors_count ?? 0,
          vectorsCount: info.vectors_count ?? null,
          vectorSize,
          distance,
          segmentsCount: info.segments_count,
        },
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РєРѕР»Р»РµРєС†РёРё",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("РћС€РёР±РєР° Qdrant РїСЂРё СЃРѕР·РґР°РЅРёРё РєРѕР»Р»РµРєС†РёРё:", error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error("РћС€РёР±РєР° РїСЂРё СЃРѕР·РґР°РЅРёРё РєРѕР»Р»РµРєС†РёРё Qdrant:", error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РєРѕР»Р»РµРєС†РёСЋ",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.delete("/api/vector/collections/:name", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const client = getQdrantClient();
      await client.deleteCollection(req.params.name);
      await storage.removeCollectionWorkspace(req.params.name);

      res.json({
        message: "РљРѕР»Р»РµРєС†РёСЏ СѓРґР°Р»РµРЅР°",
        name: req.params.name,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`РћС€РёР±РєР° РїСЂРё СѓРґР°Р»РµРЅРёРё РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РєРѕР»Р»РµРєС†РёСЋ", 
        details,
      });
    }
  });

  app.get("/api/skills", requireAuth, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const skillsList = await listSkills(workspaceId);
      res.json({ skills: skillsList });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/skills", requireAuth, async (req, res, next) => {
    try {
      const payload = createSkillSchema.parse(req.body);
      const { id: workspaceId } = getRequestWorkspace(req);
      const skill = await createSkill(workspaceId, payload);
      res.status(201).json({ skill });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      if (error instanceof SkillServiceError) {
        return res.status(error.status).json({ message: error.message });
      }

      next(error);
    }
  });

  app.put("/api/skills/:skillId", requireAuth, async (req, res, next) => {
    try {
      const payload = updateSkillSchema.parse(req.body);
      const { id: workspaceId } = getRequestWorkspace(req);
      const skillId = req.params.skillId;
      if (!skillId) {
        return res.status(400).json({ message: "РќРµ СѓРєР°Р·Р°РЅ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РЅР°РІС‹РєР°" });
      }

      const skill = await updateSkill(workspaceId, skillId, payload);
      res.json({ skill });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.issues });
      }

      if (error instanceof SkillServiceError) {
        return res.status(error.status).json({ message: error.message });
      }

      next(error);
    }
  });

  app.delete("/api/skills/:skillId", requireAuth, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const skillId = req.params.skillId;
      if (!skillId) {
        return res.status(400).json({ message: "РќРµ СѓРєР°Р·Р°РЅ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ РЅР°РІС‹РєР°" });
      }

      const deleted = await deleteSkill(workspaceId, skillId);
      if (!deleted) {
        return res.status(404).json({ message: "РќР°РІС‹Рє РЅРµ РЅР°Р№РґРµРЅ" });
      }

      res.status(204).send();
    } catch (error) {
      if (error instanceof SkillServiceError) {
        return res.status(error.status).json({ message: error.message });
      }

      next(error);
    }
  });

  app.post("/api/vector/collections/:name/points", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const body = upsertPointsSchema.parse(req.body);
      const client = getQdrantClient();

      const upsertPayload: Parameters<QdrantClient["upsert"]>[1] = {
        wait: body.wait,
        ordering: body.ordering,
        points: body.points as Schemas["PointStruct"][],
      };

      const result = await client.upsert(req.params.name, upsertPayload);

      res.status(202).json(result);
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ С‚РѕС‡РµРє",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `РћС€РёР±РєР° Qdrant РїСЂРё Р·Р°РіСЂСѓР·РєРµ С‚РѕС‡РµРє РІ РєРѕР»Р»РµРєС†РёСЋ ${req.params.name}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error(`РћС€РёР±РєР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ С‚РѕС‡РµРє РІ РєРѕР»Р»РµРєС†РёСЋ ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°РЅРЅС‹Рµ РІ РєРѕР»Р»РµРєС†РёСЋ",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/vector/collections/:name/search/text", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const body = textSearchPointsSchema.parse(req.body);
      const provider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);

      if (!provider) {
        return res.status(404).json({ error: "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!provider.isActive) {
        throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РѕС‚РєР»СЋС‡С‘РЅ");
      }

      const client = getQdrantClient();
      const collectionInfo = await client.getCollection(req.params.name);
      const vectorsConfig = collectionInfo.config?.params?.vectors as
        | { size?: number | null; distance?: string | null }
        | undefined;

      const collectionVectorSize = vectorsConfig?.size ?? null;
      const providerVectorSize = parseVectorSize(provider.qdrantConfig?.vectorSize);

      if (
        collectionVectorSize &&
        providerVectorSize &&
        Number(collectionVectorSize) !== Number(providerVectorSize)
      ) {
        throw new HttpError(
          400,
          `Р Р°Р·РјРµСЂ РІРµРєС‚РѕСЂР° РєРѕР»Р»РµРєС†РёРё (${collectionVectorSize}) РЅРµ СЃРѕРІРїР°РґР°РµС‚ СЃ РЅР°СЃС‚СЂРѕР№РєРѕР№ СЃРµСЂРІРёСЃР° (${providerVectorSize}).`,
        );
      }

      const accessToken = await fetchAccessToken(provider);
      const embeddingResult = await fetchEmbeddingVector(provider, accessToken, body.query);

      if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
        throw new HttpError(
          400,
          `РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» РІРµРєС‚РѕСЂ РґР»РёРЅРѕР№ ${embeddingResult.vector.length}, РѕР¶РёРґР°Р»РѕСЃСЊ ${collectionVectorSize}.`,
        );
      }

      const searchPayload: Parameters<QdrantClient["search"]>[1] = {
        vector: buildVectorPayload(
          embeddingResult.vector,
          provider.qdrantConfig?.vectorFieldName,
        ),
        limit: body.limit,
      };

      if (body.offset !== undefined) {
        searchPayload.offset = body.offset;
      }

      if (body.filter !== undefined) {
        searchPayload.filter = body.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (body.params !== undefined) {
        searchPayload.params = body.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      if (body.withPayload !== undefined) {
        searchPayload.with_payload = body.withPayload as Parameters<QdrantClient["search"]>[1]["with_payload"];
      }

      if (body.withVector !== undefined) {
        searchPayload.with_vector = body.withVector as Parameters<QdrantClient["search"]>[1]["with_vector"];
      }

      if (body.scoreThreshold !== undefined) {
        searchPayload.score_threshold = body.scoreThreshold;
      }

      if (body.shardKey !== undefined) {
        searchPayload.shard_key = body.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (body.consistency !== undefined) {
        searchPayload.consistency = body.consistency;
      }

      if (body.timeout !== undefined) {
        searchPayload.timeout = body.timeout;
      }

      const results = await client.search(req.params.name, searchPayload);

      res.json({
        results,
        queryVector: embeddingResult.vector,
        vectorLength: embeddingResult.vector.length,
        usageTokens: embeddingResult.usageTokens ?? null,
        provider: {
          id: provider.id,
          name: provider.name,
        },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕРёСЃРєР°",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(`РћС€РёР±РєР° Qdrant РїСЂРё С‚РµРєСЃС‚РѕРІРѕРј РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error(`РћС€РёР±РєР° РїСЂРё С‚РµРєСЃС‚РѕРІРѕРј РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ С‚РµРєСЃС‚РѕРІС‹Р№ РїРѕРёСЃРє",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/vector/collections/:name/search/generative", async (req, res) => {
    try {
      const workspaceContext = await resolveGenerativeWorkspace(req, res);
      if (!workspaceContext) {
        return;
      }

      const { workspaceId } = workspaceContext;
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const payloadSource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};

      delete payloadSource.apiKey;
      delete payloadSource.publicId;
      delete payloadSource.sitePublicId;
      delete payloadSource.workspaceId;
      delete payloadSource.workspace_id;

      const body = generativeSearchPointsSchema.parse(payloadSource);
      const responseFormatCandidate = normalizeResponseFormat(body.responseFormat);
      if (responseFormatCandidate === null) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С„РѕСЂРјР°С‚ РѕС‚РІРµС‚Р°",
          details: "РџРѕРґРґРµСЂР¶РёРІР°СЋС‚СЃСЏ Р·РЅР°С‡РµРЅРёСЏ text, md/markdown РёР»Рё html",
        });
      }

      const responseFormat: RagResponseFormat = responseFormatCandidate ?? "text";
      const includeContextInResponse = body.includeContext ?? true;
      const includeQueryVectorInResponse = body.includeQueryVector ?? true;
      const llmResponseFormatCandidate = normalizeResponseFormat(body.llmResponseFormat);
      if (llmResponseFormatCandidate === null) {
        return res.status(400).json({
          error: "Неверный формат ответа LLM",
          details: "Допустимые варианты формата: text, md/markdown или html",
        });
      }
      const llmResponseFormatNormalized =
        llmResponseFormatCandidate ?? responseFormat;
      const embeddingProvider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);

      if (!embeddingProvider) {
        return res.status(404).json({ error: "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!embeddingProvider.isActive) {
        throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РѕС‚РєР»СЋС‡С‘РЅ");
      }

      const llmProvider = await storage.getLlmProvider(body.llmProviderId, workspaceId);

      if (!llmProvider) {
        return res.status(404).json({ error: "РџСЂРѕРІР°Р№РґРµСЂ LLM РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!llmProvider.isActive) {
        throw new HttpError(400, "Р’С‹Р±СЂР°РЅРЅС‹Р№ РїСЂРѕРІР°Р№РґРµСЂ LLM РѕС‚РєР»СЋС‡С‘РЅ");
      }

      const llmRequestConfig = mergeLlmRequestConfig(llmProvider);

      if (body.llmSystemPrompt !== undefined) {
        llmRequestConfig.systemPrompt = body.llmSystemPrompt || undefined;
      }

      if (body.llmTemperature !== undefined) {
        llmRequestConfig.temperature = body.llmTemperature;
      }

      if (body.llmMaxTokens !== undefined) {
        llmRequestConfig.maxTokens = body.llmMaxTokens;
      }

      const configuredLlmProvider: LlmProvider = {
        ...llmProvider,
        requestConfig: llmRequestConfig,
      };

      const sanitizedModels = sanitizeLlmModelOptions(configuredLlmProvider.availableModels);
      const requestedModel = typeof body.llmModel === "string" ? body.llmModel.trim() : "";
      const normalizedModelFromList =
        sanitizedModels.find((model) => model.value === requestedModel)?.value ??
        sanitizedModels.find((model) => model.label === requestedModel)?.value ??
        null;
      const selectedModelValue =
        (normalizedModelFromList && normalizedModelFromList.trim().length > 0
          ? normalizedModelFromList.trim()
          : undefined) ??
        (requestedModel.length > 0 ? requestedModel : undefined) ??
        configuredLlmProvider.model;
      const selectedModelMeta =
        sanitizedModels.find((model) => model.value === selectedModelValue) ?? null;

      const client = getQdrantClient();
      const collectionInfo = await client.getCollection(req.params.name);
      const vectorsConfig = collectionInfo.config?.params?.vectors as
        | { size?: number | null; distance?: string | null }
        | undefined;

      const collectionVectorSize = vectorsConfig?.size ?? null;
      const providerVectorSize = parseVectorSize(embeddingProvider.qdrantConfig?.vectorSize);

      if (
        collectionVectorSize &&
        providerVectorSize &&
        Number(collectionVectorSize) !== Number(providerVectorSize)
      ) {
        throw new HttpError(
          400,
          `Р Р°Р·РјРµСЂ РІРµРєС‚РѕСЂР° РєРѕР»Р»РµРєС†РёРё (${collectionVectorSize}) РЅРµ СЃРѕРІРїР°РґР°РµС‚ СЃ РЅР°СЃС‚СЂРѕР№РєРѕР№ СЃРµСЂРІРёСЃР° (${providerVectorSize}).`,
        );
      }

      const embeddingAccessToken = await fetchAccessToken(embeddingProvider);
      const embeddingResult = await fetchEmbeddingVector(embeddingProvider, embeddingAccessToken, body.query);

      if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
        throw new HttpError(
          400,
          `РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» РІРµРєС‚РѕСЂ РґР»РёРЅРѕР№ ${embeddingResult.vector.length}, РѕР¶РёРґР°Р»РѕСЃСЊ ${collectionVectorSize}.`,
        );
      }

      const searchPayload: Parameters<QdrantClient["search"]>[1] = {
        vector: buildVectorPayload(
          embeddingResult.vector,
          embeddingProvider.qdrantConfig?.vectorFieldName,
        ),
        limit: body.limit,
      };

      if (body.offset !== undefined) {
        searchPayload.offset = body.offset;
      }

      if (body.filter !== undefined) {
        searchPayload.filter = body.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (body.params !== undefined) {
        searchPayload.params = body.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      searchPayload.with_payload = (body.withPayload ?? true) as Parameters<
        QdrantClient["search"]
      >[1]["with_payload"];

      if (body.withVector !== undefined) {
        searchPayload.with_vector = body.withVector as Parameters<QdrantClient["search"]>[1]["with_vector"];
      }

      if (body.scoreThreshold !== undefined) {
        searchPayload.score_threshold = body.scoreThreshold;
      }

      if (body.shardKey !== undefined) {
        searchPayload.shard_key = body.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (body.consistency !== undefined) {
        searchPayload.consistency = body.consistency;
      }

      if (body.timeout !== undefined) {
        searchPayload.timeout = body.timeout;
      }

      const results = await client.search(req.params.name, searchPayload);

      const sanitizedResults = results.map((result) => {
        const payload = result.payload ?? null;
        return {
          id: result.id,
          payload,
          score: result.score ?? null,
          shard_key: result.shard_key ?? null,
          order_value: result.order_value ?? null,
        };
      });

      const desiredContext = body.contextLimit ?? sanitizedResults.length;
      const contextLimit = Math.max(0, Math.min(desiredContext, sanitizedResults.length));
      const contextRecords: LlmContextRecord[] = sanitizedResults.slice(0, contextLimit).map((entry, index) => {
        const basePayload = entry.payload;
        let contextPayload: Record<string, unknown> | null = null;

        if (basePayload && typeof basePayload === "object" && !Array.isArray(basePayload)) {
          contextPayload = { ...(basePayload as Record<string, unknown>) };
        } else if (basePayload !== null && basePayload !== undefined) {
          contextPayload = { value: basePayload };
        }

        return {
          index: index + 1,
          score: typeof entry.score === "number" ? entry.score : null,
          payload: contextPayload,
        } satisfies LlmContextRecord;
      });

      const llmAccessToken = await fetchAccessToken(configuredLlmProvider);
      const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
      const wantsStreamingResponse =
        configuredLlmProvider.providerType === "gigachat" && acceptHeader.toLowerCase().includes("text/event-stream");

      if (wantsStreamingResponse) {
        await streamGigachatCompletion({
          req,
          res,
          provider: configuredLlmProvider,
          accessToken: llmAccessToken,
          query: body.query,
          context: contextRecords,
          sanitizedResults,
          embeddingResult,
          embeddingProvider,
          selectedModelValue,
          selectedModelMeta,
          limit: body.limit,
          contextLimit,
          responseFormat: llmResponseFormatNormalized,
          includeContextInResponse,
          includeQueryVectorInResponse,
          collectionName: typeof req.params.name === "string" ? req.params.name : "",
        });
        return;
      }

      const completion = await fetchLlmCompletion(
        configuredLlmProvider,
        llmAccessToken,
        body.query,
        contextRecords,
        selectedModelValue,
        { responseFormat: llmResponseFormatNormalized },
      );

      const responsePayload: Record<string, unknown> = {
        answer: completion.answer,
        format: responseFormat,
        usage: {
          embeddingTokens: embeddingResult.usageTokens ?? null,
          llmTokens: completion.usageTokens ?? null,
        },
        provider: {
          id: llmProvider.id,
          name: llmProvider.name,
          model: selectedModelValue,
          modelLabel: selectedModelMeta?.label ?? selectedModelValue,
        },
        embeddingProvider: {
          id: embeddingProvider.id,
          name: embeddingProvider.name,
        },
      };

      if (includeContextInResponse) {
        responsePayload.context = sanitizedResults;
      }

      if (includeQueryVectorInResponse) {
        responsePayload.queryVector = embeddingResult.vector;
        responsePayload.vectorLength = embeddingResult.vector.length;
      }

      res.json(responsePayload);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕРёСЃРєР°",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(`РћС€РёР±РєР° Qdrant РїСЂРё РіРµРЅРµСЂР°С‚РёРІРЅРѕРј РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error(`РћС€РёР±РєР° РїСЂРё РіРµРЅРµСЂР°С‚РёРІРЅРѕРј РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РіРµРЅРµСЂР°С‚РёРІРЅС‹Р№ РїРѕРёСЃРє",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/vector/collections/:name/search", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const body = searchPointsSchema.parse(req.body);
      const client = getQdrantClient();

      const searchPayload = {
        vector: body.vector as Schemas["NamedVectorStruct"],
        limit: body.limit,
      } as Parameters<QdrantClient["search"]>[1];

      if (body.offset !== undefined) {
        searchPayload.offset = body.offset;
      }

      if (body.filter !== undefined) {
        searchPayload.filter = body.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (body.params !== undefined) {
        searchPayload.params = body.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      if (body.withPayload !== undefined) {
        searchPayload.with_payload = body.withPayload as Parameters<QdrantClient["search"]>[1]["with_payload"];
      }

      if (body.withVector !== undefined) {
        searchPayload.with_vector = body.withVector as Parameters<QdrantClient["search"]>[1]["with_vector"];
      }

      if (body.scoreThreshold !== undefined) {
        searchPayload.score_threshold = body.scoreThreshold;
      }

      if (body.shardKey !== undefined) {
        searchPayload.shard_key = body.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (body.consistency !== undefined) {
        searchPayload.consistency = body.consistency;
      }

      if (body.timeout !== undefined) {
        searchPayload.timeout = body.timeout;
      }

      const results = await client.search(req.params.name, searchPayload);

      res.json({ results });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРѕРёСЃРєР°",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(`РћС€РёР±РєР° Qdrant РїСЂРё РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error(`РћС€РёР±РєР° РїСЂРё РїРѕРёСЃРєРµ РІ РєРѕР»Р»РµРєС†РёРё ${req.params.name}:`, error);
      res.status(500).json({
        error: "РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РїРѕРёСЃРє",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Sites management


  // Extended sites with pages count - must come before /api/sites/:id





  // Crawling operations

  // Re-crawl existing site to find new pages


  // Emergency stop all crawls - simple database solution

  // Pages management

  // Search API

  // Webhook endpoint for automated crawling (e.g., from Tilda)

  app.post("/api/webhook/send-json", async (req, res) => {
    try {
      const { webhookUrl, payload } = sendJsonToWebhookSchema.parse(req.body);

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(payload);
      } catch (error) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON",
          details: error instanceof Error ? error.message : String(error)
        });
      }

      if (!Array.isArray(parsedJson)) {
        return res.status(400).json({
          error: "JSON РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РјР°СЃСЃРёРІРѕРј С‡Р°РЅРєРѕРІ"
        });
      }

      const webhookResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedJson)
      });

      const responseText = await webhookResponse.text();

      if (!webhookResponse.ok) {
        return res.status(webhookResponse.status).json({
          error: "РЈРґР°Р»С‘РЅРЅС‹Р№ РІРµР±С…СѓРє РІРµСЂРЅСѓР» РѕС€РёР±РєСѓ",
          status: webhookResponse.status,
          details: responseText
        });
      }

      res.json({
        message: "JSON СѓСЃРїРµС€РЅРѕ РѕС‚РїСЂР°РІР»РµРЅ РЅР° РІРµР±С…СѓРє",
        status: webhookResponse.status,
        response: responseText
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ Р·Р°РїСЂРѕСЃР°",
          details: error.errors
        });
      }

      console.error("РћС€РёР±РєР° РїРµСЂРµСЃС‹Р»РєРё JSON РЅР° РІРµР±С…СѓРє:", error);
      res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ JSON РЅР° РІРµР±С…СѓРє" });
    }
  });

  // Get all pages


  const crawlSelectorsSchema = z
    .object({
      title: z.string().trim().min(1).optional(),
      content: z.string().trim().min(1).optional(),
    })
    .partial();

  const crawlAuthSchema = z
    .object({
      headers: z.record(z.string()).optional(),
    })
    .partial();

  const crawlConfigSchema = z.object({
    start_urls: z.array(z.string().trim().min(1)).min(1),
    sitemap_url: z
      .string()
      .trim()
      .min(1)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    allowed_domains: z.array(z.string().trim().min(1)).optional(),
    include: z.array(z.string().trim().min(1)).optional(),
    exclude: z.array(z.string().trim().min(1)).optional(),
    max_pages: z.number().int().positive().optional(),
    max_depth: z.number().int().min(0).optional(),
    rate_limit: z.number().positive().optional(),
    rate_limit_rps: z.number().positive().optional(),
    robots_txt: z.boolean().optional(),
    selectors: crawlSelectorsSchema.optional(),
    language: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    auth: crawlAuthSchema.optional(),
  });

  const createKnowledgeBaseSchema = z.object({
    id: z
      .string()
      .trim()
      .min(1, "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ Р±Р°Р·С‹ Р·РЅР°РЅРёР№")
      .max(191, "РЎР»РёС€РєРѕРј РґР»РёРЅРЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ Р±Р°Р·С‹ Р·РЅР°РЅРёР№")
      .optional(),
    name: z
      .string()
      .trim()
      .min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№")
      .max(200, "РќР°Р·РІР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 200 СЃРёРјРІРѕР»РѕРІ"),
    description: z
      .string()
      .trim()
      .max(2000, "РћРїРёСЃР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 2000 СЃРёРјРІРѕР»РѕРІ")
      .optional(),
  });

  const createKnowledgeBaseWithCrawlSchema = z.object({
    name: z
      .string()
      .trim()
      .min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№")
      .max(200, "РќР°Р·РІР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 200 СЃРёРјРІРѕР»РѕРІ"),
    description: z.string().trim().max(2000).optional(),
    source: z.literal("crawl"),
    crawl_config: crawlConfigSchema,
  });

  const restartKnowledgeBaseCrawlSchema = z.object({
    crawl_config: crawlConfigSchema,
  });

  function mapCrawlConfig(input: z.infer<typeof crawlConfigSchema>): KnowledgeBaseCrawlConfig {
    const normalizeArray = (value?: string[]) =>
      value
        ?.map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    const startUrls = normalizeArray(input.start_urls) ?? [];

    const rateLimit =
      (typeof input.rate_limit_rps === "number" && Number.isFinite(input.rate_limit_rps)
        ? input.rate_limit_rps
        : undefined) ??
      (typeof input.rate_limit === "number" && Number.isFinite(input.rate_limit)
        ? input.rate_limit
        : undefined) ??
      null;

    return {
      startUrls,
      sitemapUrl: input.sitemap_url ?? null,
      allowedDomains: normalizeArray(input.allowed_domains) ?? undefined,
      include: normalizeArray(input.include) ?? undefined,
      exclude: normalizeArray(input.exclude) ?? undefined,
      maxPages: input.max_pages ?? null,
      maxDepth: input.max_depth ?? null,
      rateLimitRps: rateLimit,
      robotsTxt: input.robots_txt ?? true,
      selectors: input.selectors
        ? {
            title: input.selectors.title?.trim() || null,
            content: input.selectors.content?.trim() || null,
          }
        : null,
      language: input.language?.trim() || null,
      version: input.version?.trim() || null,
      auth: input.auth?.headers
        ? {
            headers: Object.fromEntries(
              Object.entries(input.auth.headers)
                .filter(([key, value]) => key.trim().length > 0 && value.trim().length > 0)
                .map(([key, value]) => [key, value.trim()]),
            ),
          }
        : null,
    } satisfies KnowledgeBaseCrawlConfig;
  }

  const deleteKnowledgeBaseSchema = z.object({
    confirmation: z
      .string()
      .trim()
      .min(1, "Р’РІРµРґРёС‚Рµ РЅР°Р·РІР°РЅРёРµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№ РґР»СЏ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ СѓРґР°Р»РµРЅРёСЏ"),
  });

  const createKnowledgeFolderSchema = z.object({
    title: z
      .string()
      .trim()
      .min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ РїРѕРґСЂР°Р·РґРµР»Р°")
      .max(200, "РќР°Р·РІР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 200 СЃРёРјРІРѕР»РѕРІ"),
  });

  const createKnowledgeDocumentSchema = z.object({
    title: z
      .string()
      .trim()
      .min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ РґРѕРєСѓРјРµРЅС‚Р°")
      .max(500, "РќР°Р·РІР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 500 СЃРёРјРІРѕР»РѕРІ"),
    content: z
      .string()
      .max(20_000_000, "Р”РѕРєСѓРјРµРЅС‚ СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№. РћРіСЂР°РЅРёС‡РµРЅРёРµ вЂ” 20 РњР‘ С‚РµРєСЃС‚Р°")
      .optional()
      .default(""),
    sourceType: z.enum(["manual", "import"]).optional(),
    importFileName: z
      .string()
      .trim()
      .max(500, "РРјСЏ С„Р°Р№Р»Р° РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 500 СЃРёРјРІРѕР»РѕРІ")
      .optional()
      .nullable(),
  });

  const createCrawledKnowledgeDocumentSchema = z.object({
    url: z
      .string()
      .trim()
      .min(1, "РЈРєР°Р¶РёС‚Рµ СЃСЃС‹Р»РєСѓ РЅР° СЃС‚СЂР°РЅРёС†Сѓ")
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      }, "РЈРєР°Р¶РёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ URL СЃС‚СЂР°РЅРёС†С‹"),
    selectors: crawlSelectorsSchema.optional(),
    language: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    auth: crawlAuthSchema.optional(),
  });

  const updateKnowledgeDocumentSchema = z.object({
    title: z
      .string()
      .trim()
      .min(1, "РЈРєР°Р¶РёС‚Рµ РЅР°Р·РІР°РЅРёРµ РґРѕРєСѓРјРµРЅС‚Р°")
      .max(500, "РќР°Р·РІР°РЅРёРµ РЅРµ РґРѕР»Р¶РЅРѕ РїСЂРµРІС‹С€Р°С‚СЊ 500 СЃРёРјРІРѕР»РѕРІ"),
    content: z
      .string()
      .max(20_000_000, "Р”РѕРєСѓРјРµРЅС‚ СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№. РћРіСЂР°РЅРёС‡РµРЅРёРµ вЂ” 20 РњР‘ С‚РµРєСЃС‚Р°")
      .optional(),
  });

  app.post("/api/kb", requireAuth, async (req, res) => {
    try {
      const payload = createKnowledgeBaseWithCrawlSchema.parse(req.body ?? {});
      const { id: workspaceId } = getRequestWorkspace(req);
      const summary = await createKnowledgeBase(workspaceId, {
        name: payload.name,
        description: payload.description,
      });

      const config = mapCrawlConfig(payload.crawl_config);
      const job = startKnowledgeBaseCrawl(workspaceId, summary.id, config);

      return res.status(201).json({
        kb_id: summary.id,
        job_id: job.jobId,
        knowledge_base: summary,
        job,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.post("/api/kb/:baseId/crawl", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const payload = restartKnowledgeBaseCrawlSchema.parse(req.body ?? {});
      const { id: workspaceId } = getRequestWorkspace(req);
      const bases = await listKnowledgeBases(workspaceId);
      const summary = bases.find((base) => base.id === baseId);
      if (!summary) {
        return res.status(404).json({ error: "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°" });
      }

      const config = mapCrawlConfig(payload.crawl_config);
      const job = startKnowledgeBaseCrawl(workspaceId, baseId, config);

      return res.status(201).json({
        kb_id: baseId,
        job_id: job.jobId,
        job,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.post("/api/knowledge/bases", requireAuth, async (req, res) => {
    try {
      const payload = createKnowledgeBaseSchema.parse(req.body ?? {});
      const { id: workspaceId } = getRequestWorkspace(req);
      const summary = await createKnowledgeBase(workspaceId, payload);
      return res.status(201).json(summary);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.get("/api/kb/:baseId/crawl/active", requireAuth, (req, res) => {
    const { baseId } = req.params;
    const { id: workspaceId } = getRequestWorkspace(req);

    const { active, latest } = getKnowledgeBaseCrawlJobStateForBase(baseId, workspaceId);
    if (!active) {
      const lastRun = latest ? { job: latest } : undefined;
      return res.json(lastRun ? { running: false, lastRun } : { running: false });
    }

    const normalizeNumber = (value?: number | null): number =>
      typeof value === "number" && Number.isFinite(value) ? value : 0;

    const progress: {
      percent: number;
      discovered: number;
      fetched: number;
      saved: number;
      errors: number;
      queued?: number;
      extracted?: number;
    } = {
      percent: normalizeNumber(active.percent),
      discovered: normalizeNumber(active.discovered),
      fetched: normalizeNumber(active.fetched),
      saved: normalizeNumber(active.saved),
      errors: normalizeNumber(active.failed),
    };

    if (typeof active.queued === "number") {
      progress.queued = normalizeNumber(active.queued);
    }

    if (typeof active.extracted === "number") {
      progress.extracted = normalizeNumber(active.extracted);
    }

    return res.json({
      running: true,
      runId: active.jobId,
      progress,
      job: active,
    });
  });

  app.delete("/api/knowledge/bases/:baseId", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const payload = deleteKnowledgeBaseSchema.parse(req.body ?? {});
      const { id: workspaceId } = getRequestWorkspace(req);
      const result = await deleteKnowledgeBase(workspaceId, baseId, payload);
      return res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.get("/api/knowledge/bases", requireAuth, async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const bases = await listKnowledgeBases(workspaceId);
      return res.json(bases);
    } catch (error) {
      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  const knowledgeBaseSearchSettingsPath = "/api/knowledge/bases/:baseId/search/settings";

  async function ensureKnowledgeBaseAccessible(baseId: string, workspaceId: string) {
    const base = await storage.getKnowledgeBase(baseId);
    if (!base || base.workspaceId !== workspaceId) {
      throw new KnowledgeBaseError("Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°", 404);
    }
  }

  app
    .route(knowledgeBaseSearchSettingsPath)
    .get(requireAuth, async (req, res) => {
      const { baseId } = req.params;

      try {
        const { id: workspaceId } = getRequestWorkspace(req);
        await ensureKnowledgeBaseAccessible(baseId, workspaceId);

        const record = await storage.getKnowledgeBaseSearchSettings(workspaceId, baseId);
        return res.json(buildSearchSettingsResponse(record));
      } catch (error) {
        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё РїРѕРёСЃРєР° Р±Р°Р·С‹ Р·РЅР°РЅРёР№:", error);
        return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё РїРѕРёСЃРєР°" });
      }
    })
    .put(requireAuth, async (req, res) => {
      const { baseId } = req.params;

      try {
        const { id: workspaceId } = getRequestWorkspace(req);
        await ensureKnowledgeBaseAccessible(baseId, workspaceId);

        const parsed = knowledgeBaseSearchSettingsSchema.parse(req.body ?? {});
        const chunkSettings = mergeChunkSearchSettings(parsed.chunkSettings ?? null);
        const ragSettings = mergeRagSearchSettings(parsed.ragSettings ?? null, {
          topK: chunkSettings.topK,
          bm25Weight: chunkSettings.bm25Weight,
        });

        const record = await storage.upsertKnowledgeBaseSearchSettings(workspaceId, baseId, {
          chunkSettings: {
            topK: chunkSettings.topK,
            bm25Weight: chunkSettings.bm25Weight,
            synonyms: chunkSettings.synonyms,
            includeDrafts: chunkSettings.includeDrafts,
            highlightResults: chunkSettings.highlightResults,
            filters: chunkSettings.filters,
          },
          ragSettings: {
            topK: ragSettings.topK,
            bm25Weight: ragSettings.bm25Weight,
            bm25Limit: ragSettings.bm25Limit,
            vectorWeight: ragSettings.vectorWeight,
            vectorLimit: ragSettings.vectorLimit,
            embeddingProviderId: ragSettings.embeddingProviderId,
            collection: ragSettings.collection,
            llmProviderId: ragSettings.llmProviderId,
            llmModel: ragSettings.llmModel,
            temperature: ragSettings.temperature,
            maxTokens: ragSettings.maxTokens,
            systemPrompt: ragSettings.systemPrompt,
            responseFormat: ragSettings.responseFormat,
          },
        });

        return res.json(buildSearchSettingsResponse(record));
      } catch (error) {
        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ", details: error.errors });
        }

        console.error("РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё РїРѕРёСЃРєР° Р±Р°Р·С‹ Р·РЅР°РЅРёР№:", error);
        return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё РїРѕРёСЃРєР°" });
      }
    });

  app.get("/api/knowledge/bases/:baseId/rag/config/latest", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const base = await storage.getKnowledgeBase(baseId);

      if (!base || base.workspaceId !== workspaceId) {
        return res.status(404).json({ error: "Р‘Р°Р·Р° Р·РЅР°РЅРёР№ РЅРµ РЅР°Р№РґРµРЅР°" });
      }

      const config = await storage.getLatestKnowledgeBaseRagConfig(workspaceId, baseId);
      const response: KnowledgeBaseRagConfigResponse = {
        config:
          config ?? {
            workspaceId,
            knowledgeBaseId: baseId,
            topK: null,
            bm25: null,
            vector: null,
            recordedAt: null,
          },
      };

      return res.json(response);
    } catch (error) {
      console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РєРѕРЅС„РёРіСѓСЂР°С†РёСЋ RAG РґР»СЏ Р±Р°Р·С‹ Р·РЅР°РЅРёР№:", error);
      return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РєРѕРЅС„РёРіСѓСЂР°С†РёСЋ RAG" });
    }
  });

  app.get("/api/knowledge/bases/:baseId/ask-ai/runs", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      await ensureKnowledgeBaseAccessible(baseId, workspaceId);

      const limitParam = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const offsetParam = typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;

      const result = await storage.listKnowledgeBaseAskAiRuns(workspaceId, baseId, {
        limit: Number.isFinite(limitParam) ? Number(limitParam) : undefined,
        offset: Number.isFinite(offsetParam) ? Number(offsetParam) : undefined,
      });

      const response: KnowledgeBaseAskAiRunListResponse = {
        items: result.items,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
      };

      return res.json(response);
    } catch (error) {
      if (error instanceof KnowledgeBaseError) {
        return res.status(error.status).json({ error: error.message });
      }

      console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ Р¶СѓСЂРЅР°Р» Ask AI:", error);
      return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ Р¶СѓСЂРЅР°Р» Ask AI" });
    }
  });

  app.get(
    "/api/knowledge/bases/:baseId/ask-ai/runs/:runId",
    requireAuth,
    async (req, res) => {
      const { baseId, runId } = req.params;

      try {
        const { id: workspaceId } = getRequestWorkspace(req);
        await ensureKnowledgeBaseAccessible(baseId, workspaceId);

        const run = await storage.getKnowledgeBaseAskAiRun(runId, workspaceId, baseId);
        if (!run) {
          return res.status(404).json({ error: "Р—Р°РїСѓСЃРє РЅРµ РЅР°Р№РґРµРЅ" });
        }

        const response: KnowledgeBaseAskAiRunDetail = run;
        return res.json(response);
      } catch (error) {
        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        console.error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РїРѕРґСЂРѕР±РЅРѕСЃС‚Рё Р·Р°РїСѓСЃРєР° Ask AI:", error);
        return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РґРµС‚Р°Р»Рё Р·Р°РїСѓСЃРєР°" });
      }
    },
  );

  app.get("/api/jobs/:jobId", requireAuth, (req, res) => {
    const { jobId } = req.params;
    const job = getKnowledgeBaseCrawlJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    return res.json({ job });
  });

  app.post("/api/jobs/:jobId/pause", requireAuth, (req, res) => {
    const { jobId } = req.params;
    const job = pauseKnowledgeBaseCrawl(jobId);
    if (!job) {
      return res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    return res.json({ job });
  });

  app.post("/api/jobs/:jobId/resume", requireAuth, (req, res) => {
    const { jobId } = req.params;
    const job = resumeKnowledgeBaseCrawl(jobId);
    if (!job) {
      return res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    return res.json({ job });
  });

  app.post("/api/jobs/:jobId/cancel", requireAuth, (req, res) => {
    const { jobId } = req.params;
    const job = cancelKnowledgeBaseCrawl(jobId);
    if (!job) {
      return res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    return res.json({ job });
  });

  app.post("/api/jobs/:jobId/retry", requireAuth, (req, res) => {
    const { jobId } = req.params;
    const { id: workspaceId } = getRequestWorkspace(req);

    try {
      const job = retryKnowledgeBaseCrawl(jobId, workspaceId);
      if (!job) {
        return res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
      }

      return res.status(201).json({ job });
    } catch (error) {
      const message = error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµР·Р°РїСѓСЃС‚РёС‚СЊ РєСЂР°СѓР»РёРЅРі";
      return res.status(409).json({ error: message });
    }
  });

  app.get("/api/jobs/:jobId/sse", requireAuth, (req, res) => {
    const { jobId } = req.params;
    const job = getKnowledgeBaseCrawlJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.flushHeaders?.();

    const sendEvent = (event: KnowledgeBaseCrawlJobStatus) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent(job);

    const unsubscribe = subscribeKnowledgeBaseCrawlJob(jobId, sendEvent);
    if (!unsubscribe) {
      res.end();
      return;
    }

    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  });

  app.get("/api/knowledge/bases/:baseId/nodes/:nodeId", requireAuth, async (req, res) => {
    const { baseId, nodeId } = req.params;

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const detail = await getKnowledgeNodeDetail(baseId, nodeId, workspaceId);
      return res.json(detail);
    } catch (error) {
      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.post("/api/knowledge/bases/:baseId/folders", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const payload = createKnowledgeFolderSchema.parse(req.body ?? {});
      const parentId = parseKnowledgeNodeParentId(req.body?.parentId);
      const { id: workspaceId } = getRequestWorkspace(req);
      const folder = await createKnowledgeFolder(baseId, workspaceId, {
        title: payload.title,
        parentId,
      });
      return res.status(201).json(folder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.post("/api/knowledge/bases/:baseId/documents/crawl", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const payload = createCrawledKnowledgeDocumentSchema.parse(req.body ?? {});
      const parentId = parseKnowledgeNodeParentId(req.body?.parentId);
      const { id: workspaceId } = getRequestWorkspace(req);

      const selectors = payload.selectors
        ? {
            title: payload.selectors.title?.trim() || null,
            content: payload.selectors.content?.trim() || null,
          }
        : null;
      const authHeaders = payload.auth?.headers
        ? Object.fromEntries(
            Object.entries(payload.auth.headers)
              .map(([key, value]) => [key.trim(), value.trim()])
              .filter(([key, value]) => key.length > 0 && value.length > 0),
          )
        : undefined;

      const result = await crawlKnowledgeDocumentPage(workspaceId, baseId, {
        url: payload.url,
        parentId,
        selectors,
        language: payload.language?.trim() || null,
        version: payload.version?.trim() || null,
        auth: authHeaders ? { headers: authHeaders } : null,
      });

      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.post("/api/knowledge/bases/:baseId/documents", requireAuth, async (req, res) => {
    const { baseId } = req.params;

    try {
      const payload = createKnowledgeDocumentSchema.parse(req.body ?? {});
      const parentId = parseKnowledgeNodeParentId(req.body?.parentId);
      const { id: workspaceId } = getRequestWorkspace(req);
      const document = await createKnowledgeDocument(baseId, workspaceId, {
        title: payload.title,
        content: payload.content,
        parentId,
        sourceType: payload.sourceType,
        importFileName: payload.importFileName ?? null,
      });
      return res.status(201).json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues.at(0);
        const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
        return res.status(400).json({ error: message });
      }

      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.patch(
    "/api/knowledge/bases/:baseId/documents/:nodeId",
    requireAuth,
    async (req, res) => {
      const { baseId, nodeId } = req.params;

      try {
        const payload = updateKnowledgeDocumentSchema.parse(req.body ?? {});
        const { id: workspaceId } = getRequestWorkspace(req);
        const user = getSessionUser(req);
        const document = await updateKnowledgeDocument(
          baseId,
          nodeId,
          workspaceId,
          {
            title: payload.title,
            content: payload.content ?? "",
          },
          user?.id ?? null,
        );
        return res.json(document);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issue = error.issues.at(0);
          const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ";
          return res.status(400).json({ error: message });
        }

        return handleKnowledgeBaseRouteError(error, res);
      }
    },
  );

  app.post(
    "/api/knowledge/bases/:baseId/documents/:nodeId/chunks/preview",
    requireAuth,
    async (req, res) => {
      const { baseId, nodeId } = req.params;

      try {
        const rawBody = (req.body ?? {}) as Record<string, unknown>;
        const configPayload =
          rawBody && typeof rawBody.config === "object" && rawBody.config !== null
            ? rawBody.config
            : rawBody;
        const config = knowledgeDocumentChunkConfigSchema.parse(configPayload ?? {});
        const { id: workspaceId } = getRequestWorkspace(req);
        const preview = await previewKnowledgeDocumentChunks(baseId, nodeId, workspaceId, config);
        return res.json(preview);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issue = error.issues.at(0);
          const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ С‡Р°РЅРєРѕРІР°РЅРёСЏ";
          return res.status(400).json({ error: message });
        }

        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        return handleKnowledgeBaseRouteError(error, res);
      }
    },
  );

  app.post(
    "/api/knowledge/bases/:baseId/documents/:nodeId/chunks",
    requireAuth,
    async (req, res) => {
      const { baseId, nodeId } = req.params;

      try {
        const rawBody = (req.body ?? {}) as Record<string, unknown>;
        const configPayload =
          rawBody && typeof rawBody.config === "object" && rawBody.config !== null
            ? rawBody.config
            : rawBody;
        const config = knowledgeDocumentChunkConfigSchema.parse(configPayload ?? {});
        const { id: workspaceId } = getRequestWorkspace(req);
        const chunkSet = await createKnowledgeDocumentChunkSet(baseId, nodeId, workspaceId, config);
        return res.status(201).json(chunkSet);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issue = error.issues.at(0);
          const message = issue?.message ?? "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ С‡Р°РЅРєРѕРІР°РЅРёСЏ";
          return res.status(400).json({ error: message });
        }

        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        return handleKnowledgeBaseRouteError(error, res);
      }
    },
  );

  app.patch("/api/knowledge/bases/:baseId/nodes/:nodeId", requireAuth, async (req, res) => {
    const { baseId, nodeId } = req.params;
    const rawParentId = req.body?.parentId as unknown;

    let parentId: string | null;
    if (rawParentId === null || rawParentId === undefined || rawParentId === "") {
      parentId = null;
    } else if (typeof rawParentId === "string") {
      parentId = rawParentId;
    } else {
      return res.status(400).json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СЂРѕРґРёС‚РµР»СЏ" });
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      await updateKnowledgeNodeParent(baseId, nodeId, { parentId }, workspaceId);
      return res.json({ success: true });
    } catch (error) {
      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.delete("/api/knowledge/bases/:baseId/nodes/:nodeId", requireAuth, async (req, res) => {
    const { baseId, nodeId } = req.params;

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const result = await deleteKnowledgeNode(baseId, nodeId, workspaceId);
      return res.json(result);
    } catch (error) {
      return handleKnowledgeBaseRouteError(error, res);
    }
  });

  app.post("/api/knowledge/documents/vectorize", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    let jobId: string | null = null;
    let responseSent = false;
    const preferHeader = req.get("prefer");
    const preferAsync =
      typeof preferHeader === "string" &&
      preferHeader
        .toLowerCase()
        .split(",")
        .map((value) => value.trim())
        .includes("respond-async");

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const {
        embeddingProviderId,
        collectionName: requestedCollectionName,
        createCollection,
        schema,
        document: vectorDocument,
        base,
        chunkSize,
        chunkOverlap,
      } = vectorizeKnowledgeDocumentSchema.parse(req.body);


      const provider = await storage.getEmbeddingProvider(embeddingProviderId, workspaceId);
      if (!provider) {
        return res.status(404).json({ error: "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РЅРµ РЅР°Р№РґРµРЅ" });
      }

      if (!provider.isActive) {
        return res.status(400).json({ error: "Р’С‹Р±СЂР°РЅРЅС‹Р№ СЃРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РѕС‚РєР»СЋС‡С‘РЅ" });
      }

      const embeddingChunkTokenLimit = extractEmbeddingTokenLimit(provider);

      const documentTextRaw = vectorDocument.text;
      const documentText = documentTextRaw.trim();
      if (documentText.length === 0) {
        return res.status(400).json({ error: "Р”РѕРєСѓРјРµРЅС‚ РЅРµ СЃРѕРґРµСЂР¶РёС‚ С‚РµРєСЃС‚Р° РґР»СЏ РІРµРєС‚РѕСЂРёР·Р°С†РёРё" });
      }

      const normalizedDocumentText = normalizeDocumentText(documentText);
      const defaultChunkSize = Math.max(200, Math.min(8000, chunkSize));
      const defaultChunkOverlap = Math.max(0, Math.min(chunkOverlap, defaultChunkSize - 1));
      const providedChunksPayload = vectorDocument.chunks;

      let documentChunks: KnowledgeDocumentChunk[] = [];
      let chunkSizeForMetadata = defaultChunkSize;
      let chunkOverlapForMetadata = defaultChunkOverlap;
      let totalChunksPlanned: number | null = null;
      const storedChunkIds = new Set<string>();
      let chunkSetIdForUpdate: string | null = null;

      if (
        providedChunksPayload &&
        Array.isArray(providedChunksPayload.items) &&
        providedChunksPayload.items.length > 0
      ) {
        const mappedChunks = providedChunksPayload.items.map(
          (item): KnowledgeDocumentChunk | null => {
            let rawText = "";
            if (typeof item.text === "string") {
              rawText = item.text;
            } else {
              const candidate = item as { content?: unknown };
              if (typeof candidate.content === "string") {
                rawText = candidate.content;
              }
            }
            const content = normalizeDocumentText(rawText);
            if (!content) {
              return null;
            }

            const indexValue =
              typeof item.index === "number" && Number.isFinite(item.index) && item.index >= 0
                ? Math.round(item.index)
                : 0;

            const startValue =
              typeof (item as { charStart?: unknown }).charStart === "number" &&
              Number.isFinite((item as { charStart?: number }).charStart ?? 0) &&
              ((item as { charStart?: number }).charStart ?? 0) >= 0
                ? Math.round((item as { charStart?: number }).charStart ?? 0)
                : typeof (item as { start?: unknown }).start === "number" &&
                  Number.isFinite((item as { start?: number }).start ?? 0) &&
                  ((item as { start?: number }).start ?? 0) >= 0
                ? Math.round((item as { start?: number }).start ?? 0)
                : 0;

            const endValue =
              typeof (item as { charEnd?: unknown }).charEnd === "number" &&
              Number.isFinite((item as { charEnd?: number }).charEnd ?? 0) &&
              ((item as { charEnd?: number }).charEnd ?? 0) >= startValue
                ? Math.round((item as { charEnd?: number }).charEnd ?? 0)
                : typeof (item as { end?: unknown }).end === "number" &&
                  Number.isFinite((item as { end?: number }).end ?? 0) &&
                  ((item as { end?: number }).end ?? 0) >= startValue
                ? Math.round((item as { end?: number }).end ?? 0)
                : startValue + content.length;

            const charCountValue = content.length;
            const wordCountValue = countPlainTextWords(content);
            const providedTokenCount = (item as { tokenCount?: unknown }).tokenCount;
            const tokenCountValue =
              typeof providedTokenCount === "number" && Number.isFinite(providedTokenCount)
                ? Math.max(0, Math.round(providedTokenCount))
                : wordCountValue;
            const excerptValue = buildDocumentExcerpt(content);

            const idValue =
              typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : undefined;

            if (idValue) {
              storedChunkIds.add(idValue);
            }

            const vectorRecordCandidate = (item as { vectorRecordId?: unknown }).vectorRecordId;
            const vectorRecordId =
              typeof vectorRecordCandidate === "string" && vectorRecordCandidate.trim().length > 0
                ? vectorRecordCandidate.trim()
                : typeof vectorRecordCandidate === "number" && Number.isFinite(vectorRecordCandidate)
                ? String(vectorRecordCandidate)
                : null;

            return {
              id: idValue,
              content,
              index: indexValue,
              start: startValue,
              end: endValue,
              charCount: charCountValue,
              wordCount: wordCountValue,
              tokenCount: tokenCountValue,
              excerpt: excerptValue,
              vectorRecordId,
            };
          },
        );

        const normalizedItems = mappedChunks.filter(
          (chunk): chunk is KnowledgeDocumentChunk => chunk !== null,
        );

        if (normalizedItems.length === 0) {
          return res.status(400).json({ error: "РџРµСЂРµРґР°РЅРЅС‹Рµ С‡Р°РЅРєРё РїСѓСЃС‚С‹Рµ РёР»Рё РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ" });
        }

        normalizedItems.sort((a, b) => a.index - b.index);
        documentChunks = normalizedItems;

        const providedChunkSetId =
          typeof providedChunksPayload.chunkSetId === "string" &&
          providedChunksPayload.chunkSetId.trim().length > 0
            ? providedChunksPayload.chunkSetId.trim()
            : null;

        if (providedChunkSetId) {
          chunkSetIdForUpdate = providedChunkSetId;
        }

        const chunkConfig = providedChunksPayload.config ?? {};
        const configMaxChars =
          typeof chunkConfig?.maxChars === "number" && Number.isFinite(chunkConfig.maxChars)
            ? Math.round(chunkConfig.maxChars)
            : null;
        const configMaxTokens =
          typeof chunkConfig?.maxTokens === "number" && Number.isFinite(chunkConfig.maxTokens)
            ? Math.round(chunkConfig.maxTokens)
            : null;
        const configOverlapChars =
          typeof chunkConfig?.overlapChars === "number" && Number.isFinite(chunkConfig.overlapChars)
            ? Math.round(chunkConfig.overlapChars)
            : null;
        const configOverlapTokens =
          typeof chunkConfig?.overlapTokens === "number" && Number.isFinite(chunkConfig.overlapTokens)
            ? Math.round(chunkConfig.overlapTokens)
            : null;

        chunkSizeForMetadata = configMaxChars ?? configMaxTokens ?? defaultChunkSize;
        chunkOverlapForMetadata = configOverlapChars ?? configOverlapTokens ?? defaultChunkOverlap;

        totalChunksPlanned =
          typeof providedChunksPayload.totalCount === "number" &&
          Number.isFinite(providedChunksPayload.totalCount) &&
          providedChunksPayload.totalCount >= documentChunks.length
            ? Math.round(providedChunksPayload.totalCount)
            : documentChunks.length;
      } else {
        documentChunks = createKnowledgeDocumentChunks(
          normalizedDocumentText,
          defaultChunkSize,
          defaultChunkOverlap,
        );

        chunkSizeForMetadata = defaultChunkSize;
        chunkOverlapForMetadata = defaultChunkOverlap;
        totalChunksPlanned = documentChunks.length;
      }

      if (documentChunks.length === 0) {
        return res.status(400).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°Р·Р±РёС‚СЊ РґРѕРєСѓРјРµРЅС‚ РЅР° С‡Р°РЅРєРё" });
      }

      if (embeddingChunkTokenLimit !== null) {
        let oversizedChunk: { index: number; tokenCount: number; id?: string } | null = null;

        for (const chunk of documentChunks) {
          if (
            typeof chunk.tokenCount === "number" &&
            Number.isFinite(chunk.tokenCount) &&
            chunk.tokenCount > embeddingChunkTokenLimit &&
            (!oversizedChunk || chunk.tokenCount > oversizedChunk.tokenCount)
          ) {
            oversizedChunk = { index: chunk.index, tokenCount: chunk.tokenCount, id: chunk.id };
          }
        }

        if (oversizedChunk) {
          const chunkNumber = oversizedChunk.index + 1;
          const limitMessage =
            `Р§Р°РЅРє #${chunkNumber} РїСЂРµРІС‹С€Р°РµС‚ РґРѕРїСѓСЃС‚РёРјС‹Р№ Р»РёРјРёС‚ ${embeddingChunkTokenLimit.toLocaleString("ru-RU")} С‚РѕРєРµРЅРѕРІ ` +
            `(РїРѕР»СѓС‡РёР»РѕСЃСЊ ${oversizedChunk.tokenCount.toLocaleString("ru-RU")}).`;

          return res.status(400).json({
            error: limitMessage,
            chunkIndex: chunkNumber,
            chunkId: oversizedChunk.id ?? null,
            tokenCount: oversizedChunk.tokenCount,
            tokenLimit: embeddingChunkTokenLimit,
          });
        }
      }

      const totalChunks = totalChunksPlanned ?? documentChunks.length;

      if (totalChunks > 0 && !jobId) {
        const startedAtIso = new Date().toISOString();
        const newJob: KnowledgeDocumentVectorizationJobInternal = {
          id: randomUUID(),
          workspaceId,
          documentId: vectorDocument.id,
          status: "pending",
          totalChunks,
          processedChunks: 0,
          startedAt: startedAtIso,
          finishedAt: null,
          error: null,
          result: null,
        };

        jobId = newJob.id;
        knowledgeDocumentVectorizationJobs.set(newJob.id, newJob);
        res.setHeader("X-Vectorization-Job-Id", newJob.id);
        res.setHeader("X-Vectorization-Total-Chunks", String(totalChunks));

        if (preferAsync) {
          responseSent = true;
          res.status(202).json({
            message: "Р”РѕРєСѓРјРµРЅС‚ РѕС‚РїСЂР°РІР»РµРЅ РЅР° РІРµРєС‚РѕСЂРёР·Р°С†РёСЋ", 
            jobId: newJob.id,
            totalChunks,
            status: "accepted",
          });
        }
      }

      const markImmediateFailure = (message: string, status = 500, details?: unknown) => {
        if (!jobId) {
          return;
        }

        updateKnowledgeDocumentVectorizationJob(jobId, {
          status: "failed",
          error: message,
          finishedAt: new Date().toISOString(),
        });
        scheduleKnowledgeDocumentVectorizationJobCleanup(jobId, VECTORIZE_JOB_FAILURE_CLEANUP_DELAY_MS);
        if (responseSent) {
          throw new HttpError(status, message, details);
        }
      };

      const collectionName =
        requestedCollectionName && requestedCollectionName.trim().length > 0
          ? requestedCollectionName.trim()
          : buildKnowledgeCollectionName(base ?? null, provider, workspaceId);

      const normalizedSchemaFields: CollectionSchemaFieldInput[] = (schema?.fields ?? []).map((field) => ({
        name: field.name.trim(),
        type: field.type,
        isArray: Boolean(field.isArray),
        template: field.template ?? "",
      }));
      const hasCustomSchema = normalizedSchemaFields.length > 0;

      let existingWorkspaceId = await storage.getCollectionWorkspace(collectionName);
      if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
        markImmediateFailure("РљРѕР»Р»РµРєС†РёСЏ РїСЂРёРЅР°РґР»РµР¶РёС‚ РґСЂСѓРіРѕРјСѓ СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ", 403);
        return res.status(403).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РїСЂРёРЅР°РґР»РµР¶РёС‚ РґСЂСѓРіРѕРјСѓ СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ",
        });
      }

      const client = getQdrantClient();
      const shouldCreateCollection = Boolean(createCollection);
      let collectionExists = false;

      try {
        await client.getCollection(collectionName);
        collectionExists = true;
      } catch (collectionError) {
        const qdrantError = extractQdrantApiError(collectionError);
        if (qdrantError) {
          if (qdrantError.status === 404) {
            if (!shouldCreateCollection) {
              markImmediateFailure(`РљРѕР»Р»РµРєС†РёСЏ ${collectionName} РЅРµ РЅР°Р№РґРµРЅР°`, 404, qdrantError.details);
              return res.status(404).json({
                error: `РљРѕР»Р»РµРєС†РёСЏ ${collectionName} РЅРµ РЅР°Р№РґРµРЅР°`,
                details: qdrantError.details,
              });
            }
          } else {
            return res.status(qdrantError.status).json({
              error: qdrantError.message,
              details: qdrantError.details,
            });
          }
        } else {
          throw collectionError;
        }
      }

      if (collectionExists && !existingWorkspaceId) {
        try {
          await storage.upsertCollectionWorkspace(collectionName, workspaceId);
          existingWorkspaceId = workspaceId;
        } catch (mappingError) {
          const message =
            mappingError instanceof Error
              ? mappingError.message
              : "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРІСЏР·Р°С‚СЊ РєРѕР»Р»РµРєС†РёСЋ Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ";
          console.error(
            `РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРІСЏР·Р°С‚СЊ СЃСѓС‰РµСЃС‚РІСѓСЋС‰СѓСЋ РєРѕР»Р»РµРєС†РёСЋ ${collectionName} Рє СЂР°Р±РѕС‡РµРјСѓ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІСѓ ${workspaceId}:`,
            mappingError,
          );
          markImmediateFailure(message, 500);
          return res.status(500).json({
            error: message,
          });
        }
      }

      const accessToken = await fetchAccessToken(provider);
      if (jobId) {
        updateKnowledgeDocumentVectorizationJob(jobId, { status: "running" });
      }
      const embeddingResults: Array<
        EmbeddingVectorResult & { chunk: KnowledgeDocumentChunk; index: number }
      > = [];

      for (let index = 0; index < documentChunks.length; index += 1) {
        const chunk = documentChunks[index];

        try {
          const result = await fetchEmbeddingVector(provider, accessToken, chunk.content);
          embeddingResults.push({ ...result, chunk, index });
          if (jobId) {
            updateKnowledgeDocumentVectorizationJob(jobId, {
              status: "running",
              processedChunks: embeddingResults.length,
            });
          }
        } catch (embeddingError) {
          console.error("РћС€РёР±РєР° СЌРјР±РµРґРґРёРЅРіР° С‡Р°РЅРєР° РґРѕРєСѓРјРµРЅС‚Р° Р±Р°Р·С‹ Р·РЅР°РЅРёР№", embeddingError);
          const errorMessage =
            embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
          throw new Error(`РћС€РёР±РєР° СЌРјР±РµРґРґРёРЅРіР° С‡Р°РЅРєР° #${index + 1}: ${errorMessage}`);
        }
      }

      if (embeddingResults.length === 0) {
        markImmediateFailure("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЌРјР±РµРґРґРёРЅРіРё РґР»СЏ РґРѕРєСѓРјРµРЅС‚Р°");
        return res.status(500).json({ error: "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЌРјР±РµРґРґРёРЅРіРё РґР»СЏ РґРѕРєСѓРјРµРЅС‚Р°" });
      }

      const firstVector = embeddingResults[0]?.vector;
      if (!Array.isArray(firstVector) || firstVector.length === 0) {
        markImmediateFailure("РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РІРµРєС‚РѕСЂ");
        return res.status(500).json({ error: "РЎРµСЂРІРёСЃ СЌРјР±РµРґРґРёРЅРіРѕРІ РІРµСЂРЅСѓР» РїСѓСЃС‚РѕР№ РІРµРєС‚РѕСЂ" });
      }

      let collectionCreated = false;
      const detectedVectorLength = firstVector.length;

      if (!collectionExists) {
        try {
          const created = await ensureCollectionCreatedIfNeeded({
            client,
            provider,
            collectionName,
            detectedVectorLength,
            shouldCreateCollection,
            collectionExists,
          });
          if (created) {
            collectionCreated = true;
            collectionExists = true;
            await storage.upsertCollectionWorkspace(collectionName, workspaceId);
          }
        } catch (creationError) {
          const qdrantError = extractQdrantApiError(creationError);
          if (qdrantError) {
            return res.status(qdrantError.status).json({
              error: qdrantError.message,
              details: qdrantError.details,
            });
          }

          throw creationError;
        }
      }

      const resolvedCharCount =
        typeof vectorDocument.charCount === "number" && vectorDocument.charCount >= 0
          ? vectorDocument.charCount
          : normalizedDocumentText.length;
      const resolvedWordCount =
        typeof vectorDocument.wordCount === "number" && vectorDocument.wordCount >= 0
          ? vectorDocument.wordCount
          : countPlainTextWords(normalizedDocumentText);
      const resolvedExcerpt =
        typeof vectorDocument.excerpt === "string" && vectorDocument.excerpt.trim().length > 0
          ? vectorDocument.excerpt
          : normalizedDocumentText.slice(0, 160);

      const documentTextForPayload = truncatePayloadValue(
        documentText,
        KNOWLEDGE_DOCUMENT_PAYLOAD_TEXT_LIMIT,
      );
      const documentHtmlForPayload = truncatePayloadValue(
        vectorDocument.html,
        KNOWLEDGE_DOCUMENT_PAYLOAD_HTML_LIMIT,
      );

      const vectorRecordMappings: Array<{ chunkId: string; vectorRecordId: string }> = [];

      const points: Schemas["PointStruct"][] = embeddingResults.map((result) => {
        const { chunk, vector, usageTokens, embeddingId, index } = result;
        const fallbackChunkId = `${vectorDocument.path ?? vectorDocument.id}-chunk-${index + 1}`;
        const resolvedChunkId =
          typeof chunk.id === "string" && chunk.id.trim().length > 0 ? chunk.id.trim() : fallbackChunkId;
        const pointId = normalizePointId(resolvedChunkId);

        if (storedChunkIds.has(resolvedChunkId)) {
          const recordIdValue = typeof pointId === "number" ? pointId.toString() : String(pointId);
          vectorRecordMappings.push({ chunkId: resolvedChunkId, vectorRecordId: recordIdValue });
        }

        const templateContext = removeUndefinedDeep({
          document: {
            id: vectorDocument.id,
            title: vectorDocument.title ?? null,
            text: documentText,
            textPreview: documentTextForPayload,
            html: vectorDocument.html ?? null,
            htmlPreview: documentHtmlForPayload,
            path: vectorDocument.path ?? null,
            updatedAt: vectorDocument.updatedAt ?? null,
            charCount: resolvedCharCount,
            wordCount: resolvedWordCount,
            excerpt: resolvedExcerpt,
            totalChunks,
            chunkSize: chunkSizeForMetadata,
            chunkOverlap: chunkOverlapForMetadata,
          },
          base: base
            ? {
                id: base.id,
                name: base.name ?? null,
                description: base.description ?? null,
              }
            : null,
          provider: {
            id: provider.id,
            name: provider.name,
          },
          chunk: {
            id: resolvedChunkId,
            index,
            position: chunk.start,
            start: chunk.start,
            end: chunk.end,
            text: chunk.content,
            charCount: chunk.charCount,
            wordCount: chunk.wordCount,
            tokenCount: chunk.tokenCount,
            excerpt: chunk.excerpt,
          },
          embedding: {
            model: provider.model,
            vectorSize: vector.length,
            tokens: usageTokens ?? null,
            id: embeddingId ?? null,
          },
        }) as Record<string, unknown>;

        const rawPayload = {
          document: {
            id: vectorDocument.id,
            title: vectorDocument.title ?? null,
            text: documentTextForPayload,
            html: documentHtmlForPayload,
            path: vectorDocument.path ?? null,
            updatedAt: vectorDocument.updatedAt ?? null,
            charCount: resolvedCharCount,
            wordCount: resolvedWordCount,
            excerpt: resolvedExcerpt,
            totalChunks,
            chunkSize: chunkSizeForMetadata,
            chunkOverlap: chunkOverlapForMetadata,
          },
          base: base
            ? {
                id: base.id,
                name: base.name ?? null,
                description: base.description ?? null,
              }
            : null,
          provider: {
            id: provider.id,
            name: provider.name,
          },
          chunk: {
            id: resolvedChunkId,
            index,
            position: chunk.start,
            start: chunk.start,
            end: chunk.end,
            text: chunk.content,
            charCount: chunk.charCount,
            wordCount: chunk.wordCount,
            excerpt: chunk.excerpt,
          },
          embedding: {
            model: provider.model,
            vectorSize: vector.length,
            tokens: usageTokens ?? null,
            id: embeddingId ?? null,
          },
        };

        const customPayload = hasCustomSchema
          ? buildCustomPayloadFromSchema(normalizedSchemaFields, templateContext)
          : null;

        const payloadSource = customPayload ?? rawPayload;
        const payload = removeUndefinedDeep(payloadSource) as Record<string, unknown>;

        const pointVectorPayload = buildVectorPayload(
          vector,
          provider.qdrantConfig?.vectorFieldName,
        ) as Schemas["PointStruct"]["vector"];

        return {
          id: pointId,
          vector: pointVectorPayload,
          payload,
        };
      });

      const upsertResult = await client.upsert(collectionName, {
        wait: true,
        points,
      });

      const totalUsageTokens = embeddingResults.reduce((sum, result) => {
        return sum + (result.usageTokens ?? 0);
      }, 0);

      const recordIds = points.map((point) =>
        typeof point.id === "number" ? point.id.toString() : String(point.id),
      );

      if (chunkSetIdForUpdate && vectorRecordMappings.length > 0) {
        try {
          await updateKnowledgeDocumentChunkVectorRecords({
            workspaceId,
            chunkSetId: chunkSetIdForUpdate,
            chunkRecords: vectorRecordMappings,
          });
        } catch (updateError) {
          console.error(
            "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРІСЏР·Рё С‡Р°РЅРєРѕРІ РґРѕРєСѓРјРµРЅС‚Р° СЃ Р·Р°РїРёСЃСЏРјРё РІРµРєС‚РѕСЂРЅРѕР№ Р±Р°Р·С‹",
            updateError,
          );
        }
      }

      const jobResult: KnowledgeDocumentVectorizationJobResult = {
        message: `Р’ РєРѕР»Р»РµРєС†РёСЋ ${collectionName} РѕС‚РїСЂР°РІР»РµРЅРѕ ${points.length} С‡Р°РЅРєРѕРІ РґРѕРєСѓРјРµРЅС‚Р°`,
        pointsCount: points.length,
        collectionName,
        vectorSize: detectedVectorLength || null,
        totalUsageTokens,
        collectionCreated,
        recordIds,
        chunkSize: chunkSizeForMetadata,
        chunkOverlap: chunkOverlapForMetadata,
        documentId: vectorDocument.id,
        provider: {
          id: provider.id,
          name: provider.name,
        },
      };

      if (jobId) {
        updateKnowledgeDocumentVectorizationJob(jobId, {
          status: "completed",
          processedChunks: points.length,
          totalChunks,
          finishedAt: new Date().toISOString(),
          error: null,
          result: jobResult,
        });
        scheduleKnowledgeDocumentVectorizationJobCleanup(jobId);
      }

      if (responseSent) {
        return;
      }

      res.json({
        ...jobResult,
        vectorSize: jobResult.vectorSize ?? null,
        provider: jobResult.provider ?? undefined,
        upsertStatus: upsertResult.status ?? null,
        jobId: jobId ?? undefined,
      });
    } catch (error) {
      const markJobFailed = (message: string) => {
        if (jobId) {
          updateKnowledgeDocumentVectorizationJob(jobId, {
            status: "failed",
            error: message,
            finishedAt: new Date().toISOString(),
          });
          scheduleKnowledgeDocumentVectorizationJobCleanup(jobId, VECTORIZE_JOB_FAILURE_CLEANUP_DELAY_MS);
        }
      };

      if (error instanceof HttpError) {
        markJobFailed(error.message);
        if (responseSent) {
          console.warn("Р¤РѕРЅРѕРІР°СЏ РІРµРєС‚РѕСЂРёР·Р°С†РёСЏ РґРѕРєСѓРјРµРЅС‚Р° Р·Р°РІРµСЂС€РёР»Р°СЃСЊ СЃ РѕС€РёР±РєРѕР№:", error.message);
          return;
        }

        const payload: Record<string, unknown> = { error: error.message };
        if (error.details !== undefined) {
          payload.details = error.details;
        }

        return res.status(error.status).json(payload);
      }

      if (error instanceof z.ZodError) {
        markJobFailed("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ Р·Р°РїСЂРѕСЃР°");
        if (responseSent) {
          console.warn("РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ Р·Р°РїСЂРѕСЃР° РґР»СЏ С„РѕРЅРѕРІРѕР№ РІРµРєС‚РѕСЂРёР·Р°С†РёРё", error.errors);
          return;
        }
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°РЅРЅС‹Рµ Р·Р°РїСЂРѕСЃР°",
          details: error.errors,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        markJobFailed(error.message);
        if (responseSent) {
          console.warn("Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ РґР»СЏ С„РѕРЅРѕРІРѕР№ РІРµРєС‚РѕСЂРёР·Р°С†РёРё:", error.message);
          return;
        }
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("РћС€РёР±РєР° Qdrant РїСЂРё РѕС‚РїСЂР°РІРєРµ РґРѕРєСѓРјРµРЅС‚Р° Р±Р°Р·С‹ Р·РЅР°РЅРёР№ РІ РєРѕР»Р»РµРєС†РёСЋ", error);
        markJobFailed(qdrantError.message);
        if (responseSent) {
          return;
        }
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error("РћС€РёР±РєР° РїСЂРё РѕС‚РїСЂР°РІРєРµ РґРѕРєСѓРјРµРЅС‚Р° Р±Р°Р·С‹ Р·РЅР°РЅРёР№ РІ Qdrant:", error);
      markJobFailed(message);
      if (responseSent) {
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/knowledge/documents/vectorize/jobs/:jobId", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    const { jobId } = req.params;
    if (!jobId || !jobId.trim()) {
      res.status(400).json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ Р·Р°РґР°С‡Рё" });
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const job = knowledgeDocumentVectorizationJobs.get(jobId);

      if (!job || job.workspaceId !== workspaceId) {
        res.status(404).json({ error: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°" });
        return;
      }

      const { workspaceId: _workspaceId, ...publicJob } = job;
      res.json({ job: publicJob });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/knowledge/documents/vector-records", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const body = fetchKnowledgeVectorRecordsSchema.parse(req.body);
      const { id: workspaceId } = getRequestWorkspace(req);

      const ownerWorkspaceId = await storage.getCollectionWorkspace(body.collectionName);
      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "РљРѕР»Р»РµРєС†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°",
        });
      }

      const ids = body.recordIds.map((value) => {
        if (typeof value === "number") {
          return value;
        }

        const trimmed = value.trim();
        if (/^-?\d+$/.test(trimmed)) {
          const parsed = Number.parseInt(trimmed, 10);
          if (Number.isSafeInteger(parsed)) {
            return parsed;
          }
        }

        return trimmed;
      });

      const client = getQdrantClient();
      const includeVector = body.includeVector ?? true;

      const result = await client.retrieve(body.collectionName, {
        ids: ids as Array<string | number>,
        with_payload: true,
        with_vector: includeVector,
      });

      const records = result.map((point) => ({
        id: point.id ?? null,
        payload: point.payload ?? null,
        vector: point.vector ?? null,
        shardKey: (point as { shard_key?: string | number }).shard_key ?? null,
        version: (point as { version?: number }).version ?? null,
      }));

      res.json({ records });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant РЅРµ РЅР°СЃС‚СЂРѕРµРЅ",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ Р·Р°РїСЂРѕСЃ",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("РћС€РёР±РєР° Qdrant РїСЂРё Р·Р°РіСЂСѓР·РєРµ Р·Р°РїРёСЃРµР№ РґРѕРєСѓРјРµРЅС‚Р° Р±Р°Р·С‹ Р·РЅР°РЅРёР№:", error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error("РћС€РёР±РєР° РїСЂРё РїРѕР»СѓС‡РµРЅРёРё Р·Р°РїРёСЃРµР№ РґРѕРєСѓРјРµРЅС‚Р° Р±Р°Р·С‹ Р·РЅР°РЅРёР№:", error);
      res.status(500).json({ error: message });
    }
  });




  // Bulk delete pages

  // Statistics endpoint


  // Health check endpoint for Qdrant diagnostics
  app.get("/api/health/vector", async (_req, res) => {
    const qdrantUrl = process.env.QDRANT_URL || null;
    const maskedUrl = qdrantUrl ? maskSensitiveInfoInUrl(qdrantUrl) : null;
    const apiKeyConfigured = Boolean(process.env.QDRANT_API_KEY && process.env.QDRANT_API_KEY.trim());
    const basePayload = {
      status: "unknown" as const,
      configured: Boolean(qdrantUrl),
      connected: false,
      url: maskedUrl,
      apiKeyConfigured,
      collectionsCount: null as number | null,
      latencyMs: null as number | null,
      timestamp: new Date().toISOString(),
    };

    if (!qdrantUrl) {
      console.warn("[vector-health] QDRANT_URL РЅРµ Р·Р°РґР°РЅ вЂ” Qdrant СЃС‡РёС‚Р°РµС‚СЃСЏ РЅРµ РЅР°СЃС‚СЂРѕРµРЅРЅС‹Рј");
      return res.json({
        ...basePayload,
        status: "not_configured" as const,
        error: "РџРµСЂРµРјРµРЅРЅР°СЏ РѕРєСЂСѓР¶РµРЅРёСЏ QDRANT_URL РЅРµ Р·Р°РґР°РЅР°",
      });
    }

    try {
      const startedAt = performance.now();
      const client = getQdrantClient();
      const collectionsResponse = await client.getCollections();
      const latencyMs = Math.round(performance.now() - startedAt);
      const collections =
        collectionsResponse && typeof collectionsResponse === "object"
          ? (collectionsResponse as { collections?: unknown }).collections
          : undefined;
      const collectionsCount = Array.isArray(collections) ? collections.length : null;

      return res.json({
        ...basePayload,
        status: "ok" as const,
        connected: true,
        latencyMs,
        collectionsCount,
      });
    } catch (error) {
      const qdrantError = extractQdrantApiError(error);
      const errorMessage = qdrantError?.message ?? getErrorDetails(error);
      const errorDetails = qdrantError?.details ?? null;
      const errorName = error instanceof Error ? error.name : undefined;
      const errorCode = getNodeErrorCode(error);

      console.error("[vector-health] РћС€РёР±РєР° РїСЂРѕРІРµСЂРєРё РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє Qdrant:", error, {
        url: maskedUrl,
        errorName,
        errorCode,
      });

      return res.json({
        ...basePayload,
        status: "error" as const,
        error: errorMessage,
        errorDetails,
        errorName,
        errorCode,
      });
    }
  });

  // Health check endpoint for database diagnostics
  app.get("/api/health/db", async (req, res) => {
    try {
      console.log("рџ”Ќ Database health check requested");
      
      // Get database connection info (masked for security)
      const dbUrl = process.env.DATABASE_URL || 'not_set';
      const maskedUrl = dbUrl.replace(/:[^:]*@/, ':***@');
      
      // Check database connectivity and schema
      const dbInfo = await storage.getDatabaseHealthInfo();
      
      const healthInfo = {
        database: {
          url_masked: maskedUrl,
          connected: true,
          ...dbInfo
        },
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown'
      };
      
      console.log("вњ… Database health check:", JSON.stringify(healthInfo, null, 2));
      res.json(healthInfo);
    } catch (error) {
      console.error("вќЊ Database health check failed:", error);
      res.status(500).json({ 
        error: "Database health check failed",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}






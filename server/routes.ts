import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import fetch, {
  Headers,
  type Response as FetchResponse,
  type RequestInit as FetchRequestInit,
} from "node-fetch";
import { createHash, randomUUID, randomBytes } from "crypto";
import { performance } from "perf_hooks";
import { Agent as HttpsAgent } from "https";
import { storage } from "./storage";
import type { WorkspaceMemberWithUser } from "./storage";
import { crawler, type CrawlLogEvent } from "./crawler";
import { z } from "zod";
import { invalidateCorsCache } from "./cors-cache";
import { getQdrantClient, QdrantConfigurationError } from "./qdrant";
import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import passport from "passport";
import bcrypt from "bcryptjs";
import {
  registerUserSchema,
  type PublicUser,
  type PersonalApiToken,
  userRoles,
  insertEmbeddingProviderSchema,
  updateEmbeddingProviderSchema,
  upsertAuthProviderSchema,
  type PublicEmbeddingProvider,
  type EmbeddingProvider,
  type AuthProviderInsert,
  type ContentChunk,
  type Page,
  type Site,
  DEFAULT_QDRANT_CONFIG,
  workspaceMemberRoles,
} from "@shared/schema";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";
import {
  castValueToType,
  collectionFieldTypes,
  normalizeArrayValue,
  renderLiquidTemplate,
  type CollectionSchemaFieldInput,
  type ProjectVectorizationJobStatus,
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
} from "./auth";

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage = error.cause instanceof Error ? error.cause.message : undefined;
    if (causeMessage) {
      return `${error.message}: ${causeMessage}`;
    }
    return error.message;
  }

  return String(error);
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

function getNodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
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
    "Не удалось определить размер вектора для новой коллекции. Укажите vectorSize в настройках сервиса эмбеддингов",
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
      message = "Ошибка Qdrant";
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
    res.status(401).json({ message: "Требуется авторизация" });
    return undefined;
  }

  return user;
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return { firstName: "Пользователь", lastName: "" };
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

// Bulk delete schema
const bulkDeletePagesSchema = z.object({
  pageIds: z.array(z.string()).min(1).max(1000)
});

const sendJsonToWebhookSchema = z.object({
  webhookUrl: z.string().trim().url("Некорректный URL"),
  payload: z.string().min(1, "JSON не может быть пустым")
});

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Название проекта обязательно").max(200, "Слишком длинное название"),
  startUrls: z.array(z.string().trim().url("Некорректный URL"))
    .min(1, "Укажите хотя бы один URL"),
  crawlDepth: z.coerce.number().int().min(1).max(10),
  maxChunkSize: z.coerce.number().int().min(200).max(8000),
  chunkOverlap: z.boolean().optional().default(false),
  chunkOverlapSize: z.coerce.number().int().min(0).max(4000).optional().default(0),
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
  tokenUrl: z.string().trim().url("Некорректный URL для получения токена"),
  embeddingsUrl: z.string().trim().url("Некорректный URL сервиса эмбеддингов"),
  authorizationKey: z.string().trim().min(1, "Укажите Authorization key"),
  scope: z.string().trim().min(1, "Укажите OAuth scope"),
  model: z.string().trim().min(1, "Укажите модель эмбеддингов"),
  allowSelfSignedCertificate: z.boolean().default(false),
  requestHeaders: z.record(z.string()).default({}),
});

const TEST_EMBEDDING_TEXT = "привет!";

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

function extractEmbeddingResponse(parsedBody: unknown) {
  if (!parsedBody || typeof parsedBody !== "object") {
    throw new Error("Не удалось разобрать ответ сервиса эмбеддингов");
  }

  const body = parsedBody as Record<string, unknown>;
  const data = body.data;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Сервис эмбеддингов не вернул данные");
  }

  const firstEntry = data[0];
  if (!firstEntry || typeof firstEntry !== "object") {
    throw new Error("Сервис эмбеддингов вернул некорректный ответ");
  }

  const entryRecord = firstEntry as Record<string, unknown>;
  const vectorCandidate = entryRecord.embedding ?? entryRecord.vector;
  const vector = ensureNumberArray(vectorCandidate);

  if (!vector || vector.length === 0) {
    throw new Error("Сервис эмбеддингов не вернул числовой вектор");
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
      console.error(`Не удалось обработать поле схемы "${field.name}"`, error);
      acc[field.name] = null;
    }

    return acc;
  }, {});
}

async function fetchAccessToken(provider: EmbeddingProvider): Promise<string> {
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
        "Не удалось подключиться к сервису эмбеддингов: сертификат не прошёл проверку. Включите доверие самоподписанным сертификатам и повторите попытку.",
      );
    }

    throw new Error(`Не удалось выполнить запрос для получения токена: ${errorMessage}`);
  }

  const rawBody = await tokenResponse.text();
  const parsedBody = parseJson(rawBody);

  if (!tokenResponse.ok) {
    let message = `Сервис вернул статус ${tokenResponse.status}`;

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

    throw new Error(`Ошибка на этапе получения токена: ${message}`);
  }

  if (parsedBody && typeof parsedBody === "object") {
    const body = parsedBody as Record<string, unknown>;
    const token = body.access_token;

    if (typeof token === "string" && token.trim()) {
      return token;
    }
  }

  throw new Error("Сервис не вернул access_token");
}

interface EmbeddingVectorResult {
  vector: number[];
  usageTokens?: number;
  embeddingId?: string | number;
  rawResponse: unknown;
}

async function fetchEmbeddingVector(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
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
    throw new Error(`Не удалось выполнить запрос к сервису эмбеддингов: ${errorMessage}`);
  }

  const rawBody = await embeddingResponse.text();
  const parsedBody = parseJson(rawBody);

  if (!embeddingResponse.ok) {
    let message = `Сервис эмбеддингов вернул статус ${embeddingResponse.status}`;

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

    throw new Error(`Ошибка на этапе получения вектора: ${message}`);
  }

  const { vector, usageTokens, embeddingId } = extractEmbeddingResponse(parsedBody);

  return {
    vector,
    usageTokens,
    embeddingId,
    rawResponse: parsedBody,
  };
}

type ProjectChunkEntry = {
  page: Page;
  chunk: ContentChunk;
  index: number;
  totalChunks: number;
};

interface StartProjectVectorizationOptions {
  site: Site;
  projectChunks: ProjectChunkEntry[];
  provider: EmbeddingProvider;
  collectionName: string;
  shouldCreateCollection: boolean;
  schemaFields: CollectionSchemaFieldInput[];
  client: QdrantClient;
  collectionExists: boolean;
  workspaceId: string;
  existingWorkspaceId: string | null;
}

class ProjectVectorizationManager {
  private jobs = new Map<string, ProjectVectorizationJobStatus>();
  private runningJobs = new Map<string, Promise<void>>();

  getStatus(siteId: string): ProjectVectorizationJobStatus {
    const existing = this.jobs.get(siteId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    return {
      siteId,
      status: "idle",
      totalChunks: 0,
      processedChunks: 0,
      totalPages: 0,
      processedPages: 0,
      totalRecords: 0,
      createdRecords: 0,
      failedChunks: 0,
      startedAt: null,
      finishedAt: null,
      message: undefined,
      error: undefined,
      providerId: undefined,
      providerName: undefined,
      collectionName: undefined,
      lastUpdatedAt: now,
      totalUsageTokens: null,
      upsertStatus: null,
    } satisfies ProjectVectorizationJobStatus;
  }

  isRunning(siteId: string): boolean {
    return this.runningJobs.has(siteId);
  }

  startProjectVectorization(
    options: StartProjectVectorizationOptions,
  ): ProjectVectorizationJobStatus {
    const { site, projectChunks, provider, collectionName } = options;

    if (this.runningJobs.has(site.id)) {
      throw new Error("Векторизация уже запущена для этого проекта");
    }

    const totalChunks = projectChunks.length;
    const totalPages = new Set(projectChunks.map((entry) => entry.page.id)).size;
    const startedAt = new Date().toISOString();

    this.updateStatus(site.id, {
      siteId: site.id,
      status: "running",
      totalChunks,
      processedChunks: 0,
      totalPages,
      processedPages: 0,
      totalRecords: totalChunks,
      createdRecords: 0,
      failedChunks: 0,
      providerId: provider.id,
      providerName: provider.name,
      collectionName,
      startedAt,
      finishedAt: null,
      message: `Запущена векторизация проекта: ${totalChunks.toLocaleString("ru-RU")} записей`,
      error: undefined,
      totalUsageTokens: null,
      upsertStatus: null,
    });

    const taskPromise = this.runJob(options)
      .catch((error) => {
        console.error(
          `Ошибка фоновой векторизации проекта ${site.id}:`,
          error,
        );
      })
      .finally(() => {
        this.runningJobs.delete(site.id);
      });

    this.runningJobs.set(site.id, taskPromise);
    return this.jobs.get(site.id)!;
  }

  private updateStatus(
    siteId: string,
    patch: Partial<ProjectVectorizationJobStatus>,
  ): ProjectVectorizationJobStatus {
    const current = this.jobs.get(siteId) ?? this.getStatus(siteId);
    const next: ProjectVectorizationJobStatus = {
      ...current,
      ...patch,
      siteId,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.jobs.set(siteId, next);
    return next;
  }

  private async runJob({
    site,
    projectChunks,
    provider,
    collectionName,
    shouldCreateCollection,
    schemaFields,
    client,
    collectionExists: initialCollectionExists,
    workspaceId,
    existingWorkspaceId,
  }: StartProjectVectorizationOptions): Promise<void> {
    const siteId = site.id;
    const processedPageIds = new Set<string>();
    const totalChunks = projectChunks.length;
    const totalPages = new Set(projectChunks.map((entry) => entry.page.id)).size;
    let currentWorkspaceId = existingWorkspaceId;

    try {
      const accessToken = await fetchAccessToken(provider);
      this.updateStatus(siteId, {
        message: `Получен доступ к сервису эмбеддингов, обрабатываем ${totalChunks.toLocaleString("ru-RU")} чанков`,
      });

      const embeddingResults: Array<
        EmbeddingVectorResult & {
          chunk: ContentChunk;
          page: Page;
          index: number;
          totalChunks: number;
        }
      > = [];

      for (const entry of projectChunks) {
        const { page, chunk, index, totalChunks: pageChunks } = entry;
        const result = await fetchEmbeddingVector(
          provider,
          accessToken,
          chunk.content,
        );
        embeddingResults.push({
          ...result,
          chunk,
          page,
          index,
          totalChunks: pageChunks,
        });

        processedPageIds.add(page.id);

        this.updateStatus(siteId, {
          processedChunks: embeddingResults.length,
          processedPages: processedPageIds.size,
          createdRecords: embeddingResults.length,
          message: `Страница «${
            page.title ?? page.url ?? page.id
          }»: чанк ${index + 1} из ${pageChunks}`,
        });
      }

      if (embeddingResults.length === 0) {
        throw new Error("Не удалось получить эмбеддинги для чанков проекта");
      }

      let collectionExists = initialCollectionExists;
      const firstVector = embeddingResults[0]?.vector;
      const detectedVectorLength = Array.isArray(firstVector)
        ? firstVector.length
        : 0;

      if (!collectionExists) {
        if (detectedVectorLength <= 0) {
          throw new Error(
            "Не удалось определить размер вектора для новой коллекции",
          );
        }

        const created = await ensureCollectionCreatedIfNeeded({
          client,
          provider,
          collectionName,
          detectedVectorLength,
          shouldCreateCollection,
          collectionExists,
        });

        if (created) {
          collectionExists = true;
          this.updateStatus(siteId, {
            message: `Коллекция ${collectionName} создана. Подготавливаем записи для отправки...`,
          });
          await storage.upsertCollectionWorkspace(collectionName, workspaceId);
          currentWorkspaceId = workspaceId;
        }
      }

      if (collectionExists && currentWorkspaceId && currentWorkspaceId !== workspaceId) {
        throw new Error(`Коллекция ${collectionName} не принадлежит рабочему пространству`);
      }

      const hasCustomSchema = schemaFields.length > 0;
      const chunkCharLimit = site?.maxChunkSize ?? null;

      const points: Schemas["PointStruct"][] = embeddingResults.map(
        (result) => {
          const { chunk, page, index, totalChunks: pageChunks, vector, usageTokens, embeddingId } = result;
          const chunkPositionRaw = chunk.metadata?.position;
          const chunkPosition =
            typeof chunkPositionRaw === "number" ? chunkPositionRaw : index;
          const baseChunkId =
            chunk.id && chunk.id.trim().length > 0
              ? chunk.id
              : `${page.id}-chunk-${chunkPosition}`;
          const pointId = normalizePointId(baseChunkId);
          const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
          const chunkWordCount = chunk.metadata?.wordCount ?? null;
          const chunkExcerpt = chunk.metadata?.excerpt ?? null;

          const metadataRecord =
            page.metadata && typeof page.metadata === "object"
              ? (page.metadata as unknown as Record<string, unknown>)
              : undefined;
          const siteNameRaw = metadataRecord?.["siteName"];
          const siteUrlRaw = metadataRecord?.["siteUrl"];
          const resolvedSiteName =
            typeof siteNameRaw === "string" ? siteNameRaw : site?.name ?? null;
          const resolvedSiteUrl =
            typeof siteUrlRaw === "string" ? siteUrlRaw : site?.url ?? null;

          const templateContext = removeUndefinedDeep({
            page: {
              id: page.id,
              url: page.url,
              title: page.title ?? null,
              totalChunks: pageChunks,
              chunkCharLimit,
              metadata: page.metadata ?? null,
            },
            site: {
              id: site.id,
              name: resolvedSiteName,
              url: resolvedSiteUrl,
            },
            provider: {
              id: provider.id,
              name: provider.name,
            },
            chunk: {
              id: baseChunkId,
              index,
              position: chunkPosition,
              heading: chunk.heading ?? null,
              level: chunk.level ?? null,
              deepLink: chunk.deepLink ?? null,
              text: chunk.content,
              charCount: chunkCharCount,
              wordCount: chunkWordCount,
              excerpt: chunkExcerpt,
              metadata: chunk.metadata ?? null,
            },
            embedding: {
              model: provider.model,
              vectorSize: vector.length,
              tokens: usageTokens ?? null,
              id: embeddingId ?? null,
            },
          }) as Record<string, unknown>;

          const rawPayload = {
            page: {
              id: page.id,
              url: page.url,
              title: page.title ?? null,
              totalChunks: pageChunks,
              chunkCharLimit,
              metadata: page.metadata ?? null,
            },
            site: {
              id: site.id,
              name: site?.name ?? null,
              url: site?.url ?? null,
            },
            provider: {
              id: provider.id,
              name: provider.name,
            },
            chunk: {
              id: baseChunkId,
              index,
              position: chunkPosition,
              heading: chunk.heading ?? null,
              level: chunk.level ?? null,
              deepLink: chunk.deepLink ?? null,
              text: chunk.content,
              charCount: chunkCharCount,
              wordCount: chunkWordCount,
              excerpt: chunkExcerpt,
              metadata: chunk.metadata ?? null,
            },
            embedding: {
              model: provider.model,
              vectorSize: vector.length,
              tokens: usageTokens ?? null,
              id: embeddingId ?? null,
            },
          } as Record<string, unknown>;

          const customPayload = hasCustomSchema
            ? buildCustomPayloadFromSchema(schemaFields, templateContext)
            : null;

          const payloadSource = customPayload ?? rawPayload;
          const payload = removeUndefinedDeep(payloadSource) as Record<
            string,
            unknown
          >;

          return {
            id: pointId,
            vector: vector as Schemas["PointStruct"]["vector"],
            payload,
          } satisfies Schemas["PointStruct"];
        },
      );

      this.updateStatus(siteId, {
        createdRecords: points.length,
        message: `Подготовлено ${points.length.toLocaleString("ru-RU")} записей, отправляем в Qdrant...`,
      });

      const upsertResult = await client.upsert(collectionName, {
        wait: true,
        points,
      });

      const totalUsageTokens = embeddingResults.reduce((sum, result) => {
        return sum + (result.usageTokens ?? 0);
      }, 0);

      this.updateStatus(siteId, {
        status: "completed",
        processedChunks: totalChunks,
        processedPages: totalPages,
        createdRecords: points.length,
        failedChunks: 0,
        finishedAt: new Date().toISOString(),
        message: `В коллекцию ${collectionName} отправлено ${points.length.toLocaleString("ru-RU")} чанков из ${totalPages.toLocaleString("ru-RU")} страниц`,
        error: undefined,
        totalUsageTokens,
        upsertStatus: upsertResult.status ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus(siteId, {
        status: "failed",
        error: message,
        message,
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}

const projectVectorizationManager = new ProjectVectorizationManager();

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
    z.literal("all")
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const vectorizeCollectionSchemaFieldSchema = z.object({
  name: z.string().trim().min(1, "Укажите название поля").max(120),
  type: z.enum(collectionFieldTypes),
  isArray: z.boolean().optional().default(false),
  template: z.string().default(""),
});

const vectorizeCollectionSchemaSchema = z.object({
  fields: z
    .array(vectorizeCollectionSchemaFieldSchema)
    .max(50, "Слишком много полей в схеме"),
  embeddingFieldName: z.string().trim().min(1).max(120).optional().nullable(),
});

const vectorizePageSchema = z.object({
  embeddingProviderId: z.string().uuid("Некорректный идентификатор сервиса эмбеддингов"),
  collectionName: z
    .string()
    .trim()
    .min(1, "Укажите название коллекции")
    .optional(),
  createCollection: z.boolean().optional(),
  schema: vectorizeCollectionSchemaSchema.optional(),
});

const vectorizeKnowledgeDocumentSchema = vectorizePageSchema.extend({
  document: z.object({
    id: z.string().trim().min(1, "Укажите идентификатор документа"),
    title: z.string().optional().nullable(),
    text: z.string().trim().min(1, "Документ не может быть пустым"),
    html: z.string().optional().nullable(),
    path: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
    charCount: z.number().int().min(0).optional(),
    wordCount: z.number().int().min(0).optional(),
    excerpt: z.string().optional().nullable(),
  }),
  base: z
    .object({
      id: z.string().trim().min(1, "Укажите идентификатор библиотеки"),
      name: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

// Public search API request/response schemas
const publicSearchRequestSchema = z.object({
  query: z.string().trim().min(1),
  hitsPerPage: z.number().int().positive().max(100).default(10),
  page: z.number().int().min(0).default(0),
  facetFilters: z.array(z.string()).optional(),
  attributesToRetrieve: z.array(z.string()).optional(),
});

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
    return normalized.slice(0, maxLength) + (normalized.length > maxLength ? "…" : "");
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 2));
  const end = Math.min(normalized.length, start + maxLength);
  const excerpt = normalized.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${excerpt}${suffix}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const isGoogleAuthEnabled = () => Boolean(app.get("googleAuthConfigured"));
  const isYandexAuthEnabled = () => Boolean(app.get("yandexAuthConfigured"));

  app.post("/api/public/collections/:publicId/search", async (req, res) => {
    try {
      const headerKey = req.headers["x-api-key"];
      const apiKeyCandidates: Array<unknown> = [
        Array.isArray(headerKey) ? headerKey[0] : headerKey,
        req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).apiKey : undefined,
        req.query.apiKey,
        req.query.apikey,
      ];

      const apiKey = apiKeyCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);

      if (!apiKey) {
        return res.status(401).json({ error: "Укажите X-API-Key в заголовке или apiKey в запросе" });
      }

      const site = await storage.getSiteByPublicId(req.params.publicId);
      if (!site) {
        return res.status(404).json({ error: "Коллекция не найдена" });
      }

      if (site.publicApiKey !== apiKey) {
        return res.status(401).json({ error: "Некорректный API-ключ" });
      }

      const payloadSource: Record<string, unknown> = {};
      if (req.body && typeof req.body === "object") {
        Object.assign(payloadSource, req.body as Record<string, unknown>);
      }

      if (!("query" in payloadSource)) {
        if (typeof req.query.q === "string" && req.query.q.trim()) {
          payloadSource.query = req.query.q;
        } else if (typeof req.query.query === "string" && req.query.query.trim()) {
          payloadSource.query = req.query.query;
        }
      }

      if (!("hitsPerPage" in payloadSource) && typeof req.query.hitsPerPage === "string") {
        const parsedHits = Number.parseInt(req.query.hitsPerPage, 10);
        if (Number.isFinite(parsedHits)) {
          payloadSource.hitsPerPage = parsedHits;
        }
      }

      if (!("page" in payloadSource) && typeof req.query.page === "string") {
        const parsedPage = Number.parseInt(req.query.page, 10);
        if (Number.isFinite(parsedPage)) {
          payloadSource.page = parsedPage;
        }
      }

      const payload = publicSearchRequestSchema.parse(payloadSource);
      const cleanQuery = payload.query.trim();

      if (!cleanQuery) {
        return res.json({
          hits: [],
          nbHits: 0,
          page: payload.page,
          nbPages: 0,
          hitsPerPage: payload.hitsPerPage,
          query: payload.query,
          params: new URLSearchParams({
            query: payload.query,
            hitsPerPage: String(payload.hitsPerPage),
            page: String(payload.page),
          }).toString(),
        } satisfies PublicSearchResponse);
      }

      const offset = payload.page * payload.hitsPerPage;
      const { results, total } = await storage.searchPagesByCollection(
        cleanQuery,
        site.id,
        payload.hitsPerPage,
        offset,
      );

      const hits: PublicSearchResponse["hits"] = results.map((page) => {
        const excerptSource =
          page.metaDescription ||
          buildExcerpt(page.content, cleanQuery) ||
          (page.metadata?.description
            ? buildExcerpt(page.metadata.description, cleanQuery)
            : undefined);

        const titleHighlight = page.title ? highlightQuery(page.title, cleanQuery) : undefined;
        const contentHighlight = excerptSource ? highlightQuery(excerptSource, cleanQuery) : undefined;

        const highlightResult: Record<string, { value: string; matchLevel: string }> = {};
        if (titleHighlight && titleHighlight.matchLevel !== "none") {
          highlightResult.title = {
            value: titleHighlight.value,
            matchLevel: titleHighlight.matchLevel,
          };
        }
        if (contentHighlight && contentHighlight.matchLevel !== "none") {
          highlightResult.content = {
            value: contentHighlight.value,
            matchLevel: contentHighlight.matchLevel,
          };
        }

        const hierarchy: PublicSearchResponse["hits"][number]["hierarchy"] = {};
        if (site.name) {
          hierarchy.lvl0 = site.name;
        }
        if (page.title) {
          hierarchy.lvl1 = page.title;
        }
        if (page.metadata?.description) {
          hierarchy.lvl2 = page.metadata.description;
        }

        return {
          objectID: page.id,
          url: page.url,
          title: page.title ?? undefined,
          content: page.content ?? undefined,
          hierarchy: Object.keys(hierarchy).length > 0 ? hierarchy : undefined,
          excerpt: excerptSource ?? undefined,
          _highlightResult: Object.keys(highlightResult).length > 0 ? highlightResult : undefined,
        };
      });

      const params = new URLSearchParams({
        query: payload.query,
        hitsPerPage: String(payload.hitsPerPage),
        page: String(payload.page),
      });

      res.json({
        hits,
        nbHits: total,
        page: payload.page,
        nbPages: Math.ceil(total / payload.hitsPerPage),
        hitsPerPage: payload.hitsPerPage,
        query: payload.query,
        params: params.toString(),
      } satisfies PublicSearchResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Некорректные параметры запроса", details: error.issues });
      }

      console.error("Ошибка публичного поиска:", error);
      res.status(500).json({ error: "Не удалось выполнить поиск" });
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
        return res.status(401).json({ message: "Нет активной сессии" });
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
      res.status(404).json({ message: "Авторизация через Google недоступна" });
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
      res.status(404).json({ message: "Авторизация через Google недоступна" });
      return;
    }

    passport.authenticate("google", (err: unknown, user: PublicUser | false) => {
      const redirectTo = sanitizeRedirectPath(req.session?.oauthRedirectTo ?? "/");
      if (req.session) {
        delete req.session.oauthRedirectTo;
      }

      if (err) {
        console.error("Ошибка Google OAuth:", err);
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
      res.status(404).json({ message: "Авторизация через Yandex недоступна" });
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
      res.status(404).json({ message: "Авторизация через Yandex недоступна" });
      return;
    }

    passport.authenticate("yandex", (err: unknown, user: PublicUser | false) => {
      const redirectTo = sanitizeRedirectPath(req.session?.oauthRedirectTo ?? "/");
      if (req.session) {
        delete req.session.oauthRedirectTo;
      }

      if (err) {
        console.error("Ошибка Yandex OAuth:", err);
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
        return res.status(409).json({ message: "Пользователь с таким email уже зарегистрирован" });
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
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
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
        return res.status(401).json({ message: info?.message ?? "Неверный email или пароль" });
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
      .min(1, "Введите имя")
      .max(100, "Слишком длинное имя"),
    lastName: z
      .string()
      .trim()
      .max(120, "Слишком длинная фамилия")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(30, "Слишком длинный номер")
      .optional()
      .refine((value) => !value || /^[0-9+()\s-]*$/.test(value), "Некорректный номер телефона"),
  });

  const switchWorkspaceSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство"),
  });

  const inviteWorkspaceMemberSchema = z.object({
    email: z.string().trim().email("Введите корректный email"),
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
        return res.status(404).json({ message: "Рабочее пространство не найдено" });
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
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
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
        return res.status(404).json({ message: "Пользователь с таким email не найден" });
      }

      const { id: workspaceId } = getRequestWorkspace(req);
      const existingMembers = await storage.listWorkspaceMembers(workspaceId);
      if (existingMembers.some((entry) => entry.user.id === targetUser.id)) {
        return res.status(409).json({ message: "Пользователь уже состоит в рабочем пространстве" });
      }

      await storage.addWorkspaceMember(workspaceId, targetUser.id, payload.role);
      const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
      res.status(201).json({
        members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
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
        return res.status(404).json({ message: "Участник не найден" });
      }

      const ownerCount = members.filter((entry) => entry.member.role === "owner").length;
      if (target.member.role === "owner" && payload.role !== "owner" && ownerCount <= 1) {
        return res.status(400).json({ message: "Нельзя изменить роль единственного владельца" });
      }

      await storage.updateWorkspaceMemberRole(workspaceId, target.user.id, payload.role);
      const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
      res.json({ members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
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
        return res.status(400).json({ message: "Нельзя удалить самого себя из рабочего пространства" });
      }

      const { id: workspaceId } = getRequestWorkspace(req);
      const members = await storage.listWorkspaceMembers(workspaceId);
      const target = members.find((entry) => entry.user.id === memberId);
      if (!target) {
        return res.status(404).json({ message: "Участник не найден" });
      }

      const ownerCount = members.filter((entry) => entry.member.role === "owner").length;
      if (target.member.role === "owner" && ownerCount <= 1) {
        return res.status(400).json({ message: "Нельзя удалить единственного владельца" });
      }

      const removed = await storage.removeWorkspaceMember(workspaceId, memberId);
      if (!removed) {
        return res.status(404).json({ message: "Участник не найден" });
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
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
      }

      next(error);
    }
  });

  const changePasswordSchema = z
    .object({
      currentPassword: z
        .string()
        .min(8, "Минимальная длина пароля 8 символов")
        .max(100, "Слишком длинный пароль"),
      newPassword: z
        .string()
        .min(8, "Минимальная длина пароля 8 символов")
        .max(100, "Слишком длинный пароль"),
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: "Новый пароль должен отличаться от текущего",
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
        return res.status(404).json({ message: "Пользователь не найден" });
      }

      if (!fullUser.passwordHash) {
        return res.status(400).json({
          message: "Смена пароля недоступна для аккаунта с входом через Google",
        });
      }

      const isValid = await bcrypt.compare(currentPassword, fullUser.passwordHash);
      if (!isValid) {
        return res.status(400).json({ message: "Текущий пароль указан неверно" });
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
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
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
        return res.status(400).json({ message: "Не указан токен" });
      }

      const revokedToken = await storage.revokeUserPersonalApiToken(sessionUser.id, tokenId);
      if (!revokedToken) {
        return res.status(404).json({ message: "Токен не найден или уже отозван" });
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
        return res.status(400).json({ message: "Не указан пользователь" });
      }

      const updatedUser = await storage.updateUserRole(userId, role);
      if (!updatedUser) {
        return res.status(404).json({ message: "Пользователь не найден" });
      }

      res.json({ user: toPublicUser(updatedUser) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
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
        return res.status(400).json({ error: "Поддерживается только провайдер Google" });
      }

      const trimmedClientId = payload.clientId.trim();
      const trimmedCallbackUrl = payload.callbackUrl.trim();
      const trimmedClientSecret =
        payload.clientSecret !== undefined ? payload.clientSecret.trim() : undefined;

      const existing = await storage.getAuthProvider("google");
      const hasStoredSecret = Boolean(existing?.clientSecret && existing.clientSecret.trim().length > 0);

      if (payload.isEnabled) {
        if (trimmedClientId.length === 0) {
          return res.status(400).json({ error: "Укажите Client ID" });
        }

        const secretCandidate = trimmedClientSecret ?? "";
        if (secretCandidate.length === 0 && !hasStoredSecret) {
          return res.status(400).json({ error: "Укажите Client Secret" });
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
        console.error("Не удалось применить обновлённые настройки Google OAuth:", error);
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
        return res.status(400).json({ error: "Поддерживается только провайдер Yandex" });
      }

      const trimmedClientId = payload.clientId.trim();
      const trimmedCallbackUrl = payload.callbackUrl.trim();
      const trimmedClientSecret =
        payload.clientSecret !== undefined ? payload.clientSecret.trim() : undefined;

      const existing = await storage.getAuthProvider("yandex");
      const hasStoredSecret = Boolean(existing?.clientSecret && existing.clientSecret.trim().length > 0);

      if (payload.isEnabled) {
        if (trimmedClientId.length === 0) {
          return res.status(400).json({ error: "Укажите Client ID" });
        }

        const secretCandidate = trimmedClientSecret ?? "";
        if (secretCandidate.length === 0 && !hasStoredSecret) {
          return res.status(400).json({ error: "Укажите Client Secret" });
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
        console.error("Не удалось применить обновлённые настройки Yandex OAuth:", error);
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

      res.status(201).json({ provider: toPublicEmbeddingProvider(provider) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
      }

      const errorDetails = getErrorDetails(error);
      console.error(
        `[Embedding Services] Ошибка при создании сервиса эмбеддингов: ${errorDetails}`,
        error,
      );

      return res.status(500).json({
        message: "Не удалось создать сервис эмбеддингов",
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
            "Не удалось подключиться к сервису эмбеддингов: сертификат не прошёл проверку. Включите опцию доверия самоподписанным сертификатам и повторите попытку.";
          debugSteps.push({
            stage: "token-request",
            status: "error",
            detail: message,
          });
          return respondWithError(502, message);
        }
        const message = `Не удалось подключиться к сервису эмбеддингов${details}`;
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
        let message = `Сервис вернул статус ${tokenResponse.status}`;

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
        return respondWithError(400, `Ошибка на этапе получения токена: ${message}`);
      }

      const messageParts = ["Соединение установлено."];

      if (payload.allowSelfSignedCertificate) {
        messageParts.push("Проверка сертификата отключена.");
      }

      let accessToken: string | undefined;
      if (parsedBody && typeof parsedBody === "object") {
        const body = parsedBody as Record<string, unknown>;

        if (typeof body.access_token === "string" && body.access_token.trim()) {
          accessToken = body.access_token;
          messageParts.push("Получен access_token.");
          debugSteps.push({
            stage: "token-response",
            status: "success",
            detail: `Статус ${tokenResponse.status}. Получен access_token.`,
          });
        }

        if (typeof body.expires_in === "number") {
          messageParts.push(`Действует ${body.expires_in} с.`);
        }

        if (typeof body.expires_at === "string") {
          messageParts.push(`Истекает ${body.expires_at}.`);
        }
      } else if (typeof parsedBody === "string" && parsedBody.trim()) {
        messageParts.push(parsedBody.trim());
      }

      if (!accessToken) {
        const message = "Сервис не вернул access_token";
        debugSteps.push({
          stage: "token-response",
          status: "error",
          detail: message,
        });
        return respondWithError(400, `Ошибка на этапе получения токена: ${message}`);
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
        const message = `Не удалось выполнить запрос к сервису эмбеддингов${details}`;
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
        let message = `Сервис эмбеддингов вернул статус ${embeddingResponse.status}`;

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
        return respondWithError(400, `Ошибка на этапе получения вектора: ${message}`);
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
            : "Не удалось обработать ответ сервиса эмбеддингов";
        debugSteps.push({
          stage: "embedding-response",
          status: "error",
          detail: message,
        });
        return respondWithError(400, `Ошибка на этапе получения вектора: ${message}`);
      }

      messageParts.push(`Получен вектор длиной ${vectorLength}.`);
      debugSteps.push({
        stage: "embedding-response",
        status: "success",
        detail: `Статус ${embeddingResponse.status}. Вектор длиной ${vectorLength}.`,
      });

      if (usageTokens !== undefined) {
        messageParts.push(`Израсходовано ${usageTokens} токенов.`);
      }

      res.json({ message: messageParts.join(" "), steps: debugSteps });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
      }

      next(error);
    }
  });

  app.put("/api/embedding/services/:id", requireAdmin, async (req, res, next) => {
    try {
      const providerId = req.params.id;
      const payload = updateEmbeddingProviderSchema.parse(req.body);

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
      if (payload.requestHeaders !== undefined) updates.requestHeaders = payload.requestHeaders;
      if (payload.allowSelfSignedCertificate !== undefined)
        updates.allowSelfSignedCertificate = payload.allowSelfSignedCertificate;

      const { id: workspaceId } = getRequestWorkspace(req);
      const updated = await storage.updateEmbeddingProvider(providerId, updates, workspaceId);
      if (!updated) {
        return res.status(404).json({ message: "Сервис не найден" });
      }

      res.json({ provider: toPublicEmbeddingProvider(updated) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Некорректные данные", details: error.issues });
      }

      next(error);
    }
  });

  app.delete("/api/embedding/services/:id", requireAdmin, async (req, res, next) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const deleted = await storage.deleteEmbeddingProvider(req.params.id, workspaceId);
      if (!deleted) {
        return res.status(404).json({ message: "Сервис не найден" });
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
          "Неожиданный формат ответа Qdrant при запросе списка коллекций:",
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
              error: error instanceof Error ? error.message : "Не удалось получить сведения о коллекции",
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
          error: "Коллекция не найдена в Qdrant",
        }));

      res.json({ collections: [...existingCollections, ...missingCollections] });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("Ошибка Qdrant при получении списка коллекций:", error);

        const responseBody: Record<string, unknown> = {
          error: "Не удалось загрузить список коллекций",
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
              // Если строка похожа на JSON, но парсинг не удался, просто игнорируем её
            }
          }
        }

        return res.status(qdrantError.status).json(responseBody);
      }

      const details = getErrorDetails(error);
      console.error("Ошибка при получении коллекций Qdrant:", error);
      res.status(500).json({
        error: "Не удалось загрузить список коллекций",
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
          error: "Коллекция не найдена",
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
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`Ошибка при получении коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось получить информацию о коллекции",
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
          error: "Коллекция не найдена",
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
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`Ошибка при получении записей коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось получить записи коллекции",
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
          error: "Коллекция уже принадлежит другому рабочему пространству",
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
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные параметры коллекции",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("Ошибка Qdrant при создании коллекции:", error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error("Ошибка при создании коллекции Qdrant:", error);
      res.status(500).json({
        error: "Не удалось создать коллекцию",
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
          error: "Коллекция не найдена",
        });
      }

      const client = getQdrantClient();
      await client.deleteCollection(req.params.name);
      await storage.removeCollectionWorkspace(req.params.name);

      res.json({
        message: "Коллекция удалена",
        name: req.params.name,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`Ошибка при удалении коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось удалить коллекцию",
        details,
      });
    }
  });

  app.post("/api/vector/collections/:name/points", async (req, res) => {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({
          error: "Коллекция не найдена",
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
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные данные точек",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `Ошибка Qdrant при загрузке точек в коллекцию ${req.params.name}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error(`Ошибка при загрузке точек в коллекцию ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось загрузить данные в коллекцию",
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
          error: "Коллекция не найдена",
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
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные параметры поиска",
          details: error.errors,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(`Ошибка Qdrant при поиске в коллекции ${req.params.name}:`, error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error(`Ошибка при поиске в коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось выполнить поиск",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Sites management
  app.get("/api/sites", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const sites = await storage.getAllSites(workspaceId);
      res.json(sites);
    } catch (error) {
      console.error("Error fetching sites:", error);
      res.status(500).json({ error: "Failed to fetch sites" });
    }
  });

  app.post("/api/sites", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const validatedData = createProjectSchema.parse(req.body);
      const normalizedStartUrls = Array.from(
        new Set(
          validatedData.startUrls
            .map((url) => url.trim())
            .filter(Boolean)
        )
      );

      if (normalizedStartUrls.length === 0) {
        return res.status(400).json({ error: "Укажите хотя бы один URL" });
      }

      const primaryUrl = normalizedStartUrls[0];

      const chunkOverlapEnabled = validatedData.chunkOverlap ?? false;
      const chunkOverlapSize = chunkOverlapEnabled ? validatedData.chunkOverlapSize ?? 0 : 0;

      const { id: workspaceId } = getRequestWorkspace(req);
      const newSite = await storage.createSite({
        ownerId: user.id,
        workspaceId,
        name: validatedData.name.trim(),
        url: primaryUrl,
        startUrls: normalizedStartUrls,
        crawlDepth: validatedData.crawlDepth,
        maxChunkSize: validatedData.maxChunkSize,
        chunkOverlap: chunkOverlapEnabled,
        chunkOverlapSize,
        followExternalLinks: false,
        crawlFrequency: "manual",
        excludePatterns: [],
      });

      // Invalidate CORS cache since a new site was added
      invalidateCorsCache();
      console.log(`CORS cache invalidated after creating site: ${newSite.name} (${newSite.url ?? 'без URL'})`);

      res.status(201).json(newSite);
    } catch (error) {
      console.error("Error creating site:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create site" });
      }
    }
  });

  // Extended sites with pages count - must come before /api/sites/:id
  app.get("/api/sites/extended", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const sites = await storage.getAllSites(workspaceId);
      const sitesWithStats = await Promise.all(
        sites.map(async (site) => {
          const pages = await storage.getPagesBySiteId(site.id, workspaceId);
          return {
            ...site,
            pagesFound: pages.length,
            pagesIndexed: pages.length, // For now, all found pages are indexed
          };
        })
      );

      res.json(sitesWithStats);
    } catch (error) {
      console.error("Error fetching sites with stats:", error);
      res.status(500).json({ error: "Failed to fetch sites with statistics" });
    }
  });

  app.get("/api/sites/:id", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const site = await storage.getSite(req.params.id, workspaceId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      res.json(site);
    } catch (error) {
      console.error("Error fetching site:", error);
      res.status(500).json({ error: "Failed to fetch site" });
    }
  });

  app.put("/api/sites/:id", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const updates = req.body;
      const { id: workspaceId } = getRequestWorkspace(req);
      const updatedSite = await storage.updateSite(req.params.id, updates, workspaceId);
      if (!updatedSite) {
        return res.status(404).json({ error: "Site not found" });
      }

      // Invalidate CORS cache since site was updated (URL might have changed)
      invalidateCorsCache();
      console.log(`CORS cache invalidated after updating site: ${updatedSite?.name ?? updatedSite?.url ?? 'без названия'}`);
      
      res.json(updatedSite);
    } catch (error) {
      console.error("Error updating site:", error);
      res.status(500).json({ error: "Failed to update site" });
    }
  });

  app.post("/api/sites/:id/api-key/rotate", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const result = await storage.rotateSiteApiKey(req.params.id, workspaceId);
      if (!result) {
        return res.status(404).json({ error: "Проект не найден" });
      }

      res.json({ site: result.site, apiKey: result.apiKey });
    } catch (error) {
      console.error("Ошибка при обновлении API-ключа проекта:", error);
      res.status(500).json({ error: "Не удалось обновить API-ключ" });
    }
  });

  app.delete("/api/sites/:id", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      // Get site info before deletion for logging
      const siteToDelete = await storage.getSite(req.params.id, workspaceId);
      const success = await storage.deleteSite(req.params.id, workspaceId);
      if (!success) {
        return res.status(404).json({ error: "Site not found" });
      }
      
      // Invalidate CORS cache since a site was deleted
      invalidateCorsCache();
      console.log(`CORS cache invalidated after deleting site: ${siteToDelete?.name ?? siteToDelete?.url ?? req.params.id}`);
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting site:", error);
      res.status(500).json({ error: "Failed to delete site" });
    }
  });

  // Crawling operations
  app.post("/api/sites/:id/crawl", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const site = await storage.getSite(req.params.id, workspaceId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const configuredStartUrls = (site.startUrls ?? []).filter(Boolean);
      const fallbackUrls = site.url ? [site.url] : [];
      const availableStartUrls = configuredStartUrls.length > 0 ? configuredStartUrls : fallbackUrls;

      if (availableStartUrls.length === 0) {
        return res.status(400).json({ error: "Start URLs are not configured" });
      }

      // Start crawling in background
      crawler.crawlSite(req.params.id).catch(error => {
        console.error(`Background crawl failed for site ${req.params.id}:`, error);
      });

      res.json({ message: "Crawling started", siteId: req.params.id });
    } catch (error) {
      console.error("Error starting crawl:", error);
      res.status(500).json({ error: "Failed to start crawling" });
    }
  });

  // Re-crawl existing site to find new pages
  app.post("/api/sites/:id/recrawl", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const site = await storage.getSite(req.params.id, workspaceId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      const configuredStartUrls = (site.startUrls ?? []).filter(Boolean);
      const fallbackUrls = site.url ? [site.url] : [];
      const availableStartUrls = configuredStartUrls.length > 0 ? configuredStartUrls : fallbackUrls;

      if (availableStartUrls.length === 0) {
        return res.status(400).json({ error: "Start URLs are not configured" });
      }

      // Check if site is already being crawled
      if (site.status === 'crawling') {
        return res.status(400).json({ error: "Site is already being crawled" });
      }

      // Get current page count before recrawling for logging
      const existingPages = await storage.getPagesBySiteId(req.params.id, workspaceId);
      console.log(
        `Starting recrawl for site ${site.name ?? site.url ?? 'без названия'} - currently has ${existingPages.length} pages`
      );

      // Start re-crawling in background (uses same logic as regular crawl)
      // The crawler already handles duplicates by checking existing URLs
      crawler.crawlSite(req.params.id).catch(error => {
        console.error(`Background re-crawl failed for site ${req.params.id}:`, error);
      });

      res.json({ 
        message: "Re-crawling started", 
        siteId: req.params.id,
        existingPages: existingPages.length
      });
    } catch (error) {
      console.error("Error starting re-crawl:", error);
      res.status(500).json({ error: "Failed to start re-crawling" });
    }
  });

  app.post("/api/sites/:id/stop-crawl", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const site = await storage.getSite(req.params.id, workspaceId);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      await crawler.stopCrawl(req.params.id);
      res.json({ message: "Crawling stopped", siteId: req.params.id });
    } catch (error) {
      console.error("Error stopping crawl:", error);
      res.status(500).json({ error: "Failed to stop crawling" });
    }
  });

  // Emergency stop all crawls - simple database solution
  app.post("/api/emergency/stop-all-crawls", async (req, res) => {
    try {
      // Basic security check
      const adminToken = req.headers['x-admin-token'];
      if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
        console.warn(`Unauthorized emergency stop attempt from ${req.ip}`);
        return res.status(401).json({ error: "Unauthorized - admin token required" });
      }

      // Log the emergency action
      console.log(`Emergency stop initiated by admin from ${req.ip}`);
      
      // Simple but effective: directly reset all crawling statuses in database
      const sites = await storage.getAllSites();
      const stuckSites = sites.filter(site => site.status === 'crawling');
      
      for (const site of stuckSites) {
        await storage.updateSite(site.id, { 
          status: 'idle',
          error: 'Emergency stop - crawl terminated by admin'
        });
        console.log(`Emergency stopped crawling for site: ${site.name ?? site.url}`);
      }
      
      res.json({ 
        message: "All crawls stopped", 
        stoppedCount: stuckSites.length,
        stoppedSites: stuckSites.map(s => s.name ?? s.url),
        timestamp: new Date().toISOString() 
      });
    } catch (error) {
      console.error("Error stopping all crawls:", error);
      res.status(500).json({ error: "Failed to stop all crawls" });
    }
  });

  // Pages management
  app.get("/api/sites/:id/pages", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const pages = await storage.getPagesBySiteId(req.params.id, workspaceId);
      res.json(pages);
    } catch (error) {
      console.error("Error fetching pages:", error);
      res.status(500).json({ error: "Failed to fetch pages" });
    }
  });

  // Search API
  app.get("/api/search", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      console.log("🔍 Search API called");
      console.log("📨 Raw query params:", req.query);
      console.log("📨 Request URL:", req.url);
      console.log("📨 User-Agent:", req.get('User-Agent'));
      
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;
      const siteId = typeof req.query.siteId === "string" ? req.query.siteId.trim() : undefined;

      console.log("📊 Parsed parameters:", { 
        query: query, 
        queryLength: query?.length,
        queryBytes: Buffer.byteLength(query || '', 'utf8'),
        page, 
        limit, 
        offset 
      });

      if (!query || query.trim().length === 0) {
        console.log("❌ Empty query provided");
        return res.json({ results: [], total: 0, page, limit });
      }

      // Decode the query if it's URL encoded
      let decodedQuery = query;
      try {
        decodedQuery = decodeURIComponent(query);
        console.log("✅ Decoded query:", decodedQuery);
      } catch (decodeError) {
        console.log("⚠️ Query decode failed, using original:", query);
        decodedQuery = query;
      }

      console.log("🚀 Calling storage.searchPages with query:", decodedQuery);
      let results;
      let total;

      const { id: workspaceId } = getRequestWorkspace(req);

      if (siteId) {
        console.log("📁 Filtering search by site:", siteId);
        const site = await storage.getSite(siteId, workspaceId);
        if (!site) {
          return res.status(404).json({ error: "Проект не найден" });
        }
        ({ results, total } = await storage.searchPagesByCollection(decodedQuery, siteId, limit, offset, workspaceId));
      } else {
        ({ results, total } = await storage.searchPages(decodedQuery, limit, offset, workspaceId));
      }
      console.log("✅ Search completed:", { 
        resultsCount: results.length, 
        total,
        sampleResults: results.slice(0, 2).map(r => ({ title: r.title, url: r.url }))
      });
      
      const response = {
        results,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
      
      console.log("📤 Sending response with", results.length, "results");
      res.json(response);
    } catch (error) {
      console.error("❌ Error performing search:", error);
      console.error("❌ Error type:", typeof error);
      console.error("❌ Error message:", error instanceof Error ? error.message : 'Unknown error');
      console.error("❌ Stack trace:", error instanceof Error ? error.stack : 'No stack trace');
      res.status(500).json({ 
        error: "Failed to perform search", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Webhook endpoint for automated crawling (e.g., from Tilda)
  app.post("/api/webhook/crawl", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { url, secret } = req.body;

      // Basic security - in production, validate secret token
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      // Find site by URL among all start URLs
      const { id: workspaceId } = getRequestWorkspace(req);
      const sites = await storage.getAllSites(workspaceId);
      const normalizedUrl = url.toString().trim();
      const site = sites.find((s) => {
        if (!normalizedUrl) {
          return false;
        }

        if (s.url === normalizedUrl) {
          return true;
        }

        return (s.startUrls ?? []).some((startUrl) => startUrl === normalizedUrl);
      });
      
      if (!site) {
        return res.status(404).json({ error: "Site not found for URL" });
      }

      // Start crawling in background
      crawler.crawlSite(site.id).catch(error => {
        console.error(`Webhook crawl failed for site ${site.id}:`, error);
      });

      res.json({ 
        message: "Crawling started via webhook", 
        siteId: site.id,
        url: site.url,
        startUrls: site.startUrls,
      });
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  app.post("/api/webhook/send-json", async (req, res) => {
    try {
      const { webhookUrl, payload } = sendJsonToWebhookSchema.parse(req.body);

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(payload);
      } catch (error) {
        return res.status(400).json({
          error: "Некорректный JSON",
          details: error instanceof Error ? error.message : String(error)
        });
      }

      if (!Array.isArray(parsedJson)) {
        return res.status(400).json({
          error: "JSON должен быть массивом чанков"
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
          error: "Удалённый вебхук вернул ошибку",
          status: webhookResponse.status,
          details: responseText
        });
      }

      res.json({
        message: "JSON успешно отправлен на вебхук",
        status: webhookResponse.status,
        response: responseText
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные данные запроса",
          details: error.errors
        });
      }

      console.error("Ошибка пересылки JSON на вебхук:", error);
      res.status(500).json({ error: "Не удалось отправить JSON на вебхук" });
    }
  });

  // Get all pages
  app.get("/api/pages", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const allPages = await storage.getAllPages(workspaceId);
      res.json(allPages);
    } catch (error) {
      console.error('Error fetching pages:', error);
      res.status(500).json({ error: 'Failed to fetch pages' });
    }
  });

  app.post("/api/pages/:id/vectorize", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const {
        embeddingProviderId,
        collectionName: requestedCollectionName,
        createCollection,
        schema,
      } =
        vectorizePageSchema.parse(req.body);
      const pageId = req.params.id;

      const page = await storage.getPage(pageId, workspaceId);
      if (!page) {
        return res.status(404).json({ error: "Страница не найдена" });
      }

      const chunks = Array.isArray(page.chunks) ? (page.chunks as ContentChunk[]) : [];
      const nonEmptyChunks = chunks.filter(
        (chunk) => typeof chunk.content === "string" && chunk.content.trim().length > 0,
      );

      if (nonEmptyChunks.length === 0) {
        return res.status(400).json({ error: "У страницы нет чанков для отправки в Qdrant" });
      }

      const provider = await storage.getEmbeddingProvider(embeddingProviderId, workspaceId);
      if (!provider) {
        return res.status(404).json({ error: "Сервис эмбеддингов не найден" });
      }

      if (!provider.isActive) {
        return res.status(400).json({ error: "Выбранный сервис эмбеддингов отключён" });
      }

      const site: Site | undefined = await storage.getSite(page.siteId, workspaceId);
      const collectionName =
        requestedCollectionName && requestedCollectionName.trim().length > 0
          ? requestedCollectionName.trim()
          : buildCollectionName(site, provider, workspaceId);
      const chunkCharLimit = site?.maxChunkSize ?? null;
      const totalChunks = nonEmptyChunks.length;

      const normalizedSchemaFields: CollectionSchemaFieldInput[] = (schema?.fields ?? []).map(
        (field) => ({
          name: field.name.trim(),
          type: field.type,
          isArray: Boolean(field.isArray),
          template: field.template ?? "",
        }),
      );
      const hasCustomSchema = normalizedSchemaFields.length > 0;

      const existingWorkspaceId = await storage.getCollectionWorkspace(collectionName);
      if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
        return res.status(403).json({
          error: "Коллекция принадлежит другому рабочему пространству",
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
              return res.status(404).json({
                error: `Коллекция ${collectionName} не найдена`,
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
        return res.status(404).json({
          error: `Коллекция ${collectionName} не найдена`,
        });
      }

      const accessToken = await fetchAccessToken(provider);

      const embeddingResults: Array<
        EmbeddingVectorResult & { chunk: ContentChunk; index: number }
      > = [];

      for (let index = 0; index < nonEmptyChunks.length; index += 1) {
        const chunk = nonEmptyChunks[index];

        try {
          const result = await fetchEmbeddingVector(
            provider,
            accessToken,
            chunk.content,
          );
          embeddingResults.push({ ...result, chunk, index });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Ошибка при обработке чанка ${index + 1}: ${message}`);
        }
      }

      if (embeddingResults.length === 0) {
        return res.status(400).json({
          error: "Не удалось получить эмбеддинги для чанков страницы",
        });
      }

      let collectionCreated = false;

      const firstVector = embeddingResults[0]?.vector;
      const detectedVectorLength = Array.isArray(firstVector)
        ? firstVector.length
        : 0;

      if (!collectionExists) {
        if (detectedVectorLength <= 0) {
          return res.status(500).json({
            error: "Не удалось определить размер вектора для новой коллекции",
          });
        }

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

      const points: Schemas["PointStruct"][] = embeddingResults.map((result) => {
        const { chunk, index, vector, usageTokens, embeddingId } = result;
        const chunkPositionRaw = chunk.metadata?.position;
        const chunkPosition =
          typeof chunkPositionRaw === "number" ? chunkPositionRaw : index;
        const baseChunkId =
          chunk.id && chunk.id.trim().length > 0
            ? chunk.id
            : `${page.id}-chunk-${chunkPosition}`;
        const pointId = normalizePointId(baseChunkId);
        const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
        const chunkWordCount = chunk.metadata?.wordCount ?? null;
        const chunkExcerpt = chunk.metadata?.excerpt ?? null;

        const metadataRecord =
          page.metadata && typeof page.metadata === "object"
            ? (page.metadata as unknown as Record<string, unknown>)
            : undefined;
        const siteNameRaw = metadataRecord?.["siteName"];
        const siteUrlRaw = metadataRecord?.["siteUrl"];
        const resolvedSiteName =
          typeof siteNameRaw === "string" ? siteNameRaw : site?.name ?? null;
        const resolvedSiteUrl =
          typeof siteUrlRaw === "string" ? siteUrlRaw : site?.url ?? null;

        const templateContext = removeUndefinedDeep({
          page: {
            id: page.id,
            url: page.url,
            title: page.title ?? null,
            totalChunks,
            chunkCharLimit,
            metadata: page.metadata ?? null,
          },
          site: {
            id: page.siteId,
            name: resolvedSiteName,
            url: resolvedSiteUrl,
          },
          provider: {
            id: provider.id,
            name: provider.name,
          },
          chunk: {
            id: baseChunkId,
            index,
            position: chunkPosition,
            heading: chunk.heading ?? null,
            level: chunk.level ?? null,
            deepLink: chunk.deepLink ?? null,
            text: chunk.content,
            charCount: chunkCharCount,
            wordCount: chunkWordCount,
            excerpt: chunkExcerpt,
            metadata: chunk.metadata ?? null,
          },
          embedding: {
            model: provider.model,
            vectorSize: vector.length,
            tokens: usageTokens ?? null,
            id: embeddingId ?? null,
          },
        }) as Record<string, unknown>;

        const rawPayload = {
          page: {
            id: page.id,
            url: page.url,
            title: page.title ?? null,
            totalChunks,
            chunkCharLimit,
            metadata: page.metadata ?? null,
          },
          site: {
            id: page.siteId,
            name: site?.name ?? null,
            url: site?.url ?? null,
          },
          provider: {
            id: provider.id,
            name: provider.name,
          },
          chunk: {
            id: baseChunkId,
            index,
            position: chunkPosition,
            heading: chunk.heading ?? null,
            level: chunk.level ?? null,
            deepLink: chunk.deepLink ?? null,
            text: chunk.content,
            charCount: chunkCharCount,
            wordCount: chunkWordCount,
            excerpt: chunkExcerpt,
            metadata: chunk.metadata ?? null,
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

        return {
          id: pointId,
          vector: vector as Schemas["PointStruct"]["vector"],
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

      res.json({
        message: `В коллекцию ${collectionName} отправлено ${points.length} чанков`,
        pointsCount: points.length,
        vectorSize: detectedVectorLength || null,
        collectionName,
        provider: {
          id: provider.id,
          name: provider.name,
        },
        totalUsageTokens,
        upsertStatus: upsertResult.status ?? null,
        collectionCreated,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные данные запроса",
          details: error.errors,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `Ошибка Qdrant при отправке чанков страницы ${req.params.id}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(`Ошибка при отправке чанков страницы ${req.params.id} в Qdrant:`, error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/knowledge/documents/vectorize", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const {
        embeddingProviderId,
        collectionName: requestedCollectionName,
        createCollection,
        schema,
        document: vectorDocument,
        base,
      } = vectorizeKnowledgeDocumentSchema.parse(req.body);

      const provider = await storage.getEmbeddingProvider(embeddingProviderId, workspaceId);
      if (!provider) {
        return res.status(404).json({ error: "Сервис эмбеддингов не найден" });
      }

      if (!provider.isActive) {
        return res.status(400).json({ error: "Выбранный сервис эмбеддингов отключён" });
      }

      const documentText = vectorDocument.text.trim();
      if (documentText.length === 0) {
        return res.status(400).json({ error: "Документ не содержит текста для векторизации" });
      }

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

      const existingWorkspaceId = await storage.getCollectionWorkspace(collectionName);
      if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
        return res.status(403).json({
          error: "Коллекция принадлежит другому рабочему пространству",
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
              return res.status(404).json({
                error: `Коллекция ${collectionName} не найдена`,
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
        return res.status(404).json({
          error: `Коллекция ${collectionName} не найдена`,
        });
      }

      const accessToken = await fetchAccessToken(provider);
      const embeddingResult = await fetchEmbeddingVector(provider, accessToken, documentText);
      const { vector, usageTokens, embeddingId } = embeddingResult;

      if (!Array.isArray(vector) || vector.length === 0) {
        return res.status(500).json({ error: "Сервис эмбеддингов вернул пустой вектор" });
      }

      let collectionCreated = false;
      const detectedVectorLength = vector.length;

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
          : documentText.length;
      const resolvedWordCount =
        typeof vectorDocument.wordCount === "number" && vectorDocument.wordCount >= 0
          ? vectorDocument.wordCount
          : null;
      const resolvedExcerpt =
        typeof vectorDocument.excerpt === "string" && vectorDocument.excerpt.trim().length > 0
          ? vectorDocument.excerpt
          : documentText.slice(0, 160);

      const templateContext = removeUndefinedDeep({
        document: {
          id: vectorDocument.id,
          title: vectorDocument.title ?? null,
          text: documentText,
          html: vectorDocument.html ?? null,
          path: vectorDocument.path ?? null,
          updatedAt: vectorDocument.updatedAt ?? null,
          charCount: resolvedCharCount,
          wordCount: resolvedWordCount,
          excerpt: resolvedExcerpt,
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
        embedding: {
          model: provider.model,
          vectorSize: detectedVectorLength,
          tokens: usageTokens ?? null,
          id: embeddingId ?? null,
        },
      }) as Record<string, unknown>;

      const rawPayload = {
        document: {
          id: vectorDocument.id,
          title: vectorDocument.title ?? null,
          text: documentText,
          html: vectorDocument.html ?? null,
          path: vectorDocument.path ?? null,
          updatedAt: vectorDocument.updatedAt ?? null,
          charCount: resolvedCharCount,
          wordCount: resolvedWordCount,
          excerpt: resolvedExcerpt,
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
        embedding: {
          model: provider.model,
          vectorSize: detectedVectorLength,
          tokens: usageTokens ?? null,
          id: embeddingId ?? null,
        },
      };

      const customPayload = hasCustomSchema
        ? buildCustomPayloadFromSchema(normalizedSchemaFields, templateContext)
        : null;

      const payloadSource = customPayload ?? rawPayload;
      const payload = removeUndefinedDeep(payloadSource) as Record<string, unknown>;

      const pointIdCandidate = vectorDocument.path ?? vectorDocument.id;
      const pointId = normalizePointId(pointIdCandidate);

      const points: Schemas["PointStruct"][] = [
        {
          id: pointId,
          vector: vector as Schemas["PointStruct"]["vector"],
          payload,
        },
      ];

      const upsertResult = await client.upsert(collectionName, {
        wait: true,
        points,
      });

      res.json({
        message: `В коллекцию ${collectionName} отправлен документ`,
        pointsCount: points.length,
        collectionName,
        vectorSize: detectedVectorLength || null,
        provider: {
          id: provider.id,
          name: provider.name,
        },
        totalUsageTokens: usageTokens ?? null,
        upsertStatus: upsertResult.status ?? null,
        collectionCreated,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные данные запроса",
          details: error.errors,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error("Ошибка Qdrant при отправке документа базы знаний в коллекцию", error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error("Ошибка при отправке документа базы знаний в Qdrant:", error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/sites/:id/vectorize", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const {
        embeddingProviderId,
        collectionName: requestedCollectionName,
        createCollection,
        schema,
      } = vectorizePageSchema.parse(req.body);
      const siteId = req.params.id;

      const site = await storage.getSite(siteId, workspaceId);
      if (!site) {
        return res.status(404).json({ error: "Проект не найден" });
      }

      const pages = await storage.getPagesBySiteId(siteId, workspaceId);
      const projectChunks = pages.flatMap((page) => {
        const pageChunks = Array.isArray(page.chunks)
          ? (page.chunks as ContentChunk[])
          : [];
        const nonEmptyChunks = pageChunks.filter(
          (chunk) => typeof chunk.content === "string" && chunk.content.trim().length > 0,
        );

        return nonEmptyChunks.map((chunk, index) => ({
          page,
          chunk,
          index,
          totalChunks: nonEmptyChunks.length,
        }));
      });

      if (projectChunks.length === 0) {
        return res.status(400).json({
          error: "У проекта нет чанков для отправки в Qdrant",
        });
      }

      const provider = await storage.getEmbeddingProvider(embeddingProviderId, workspaceId);
      if (!provider) {
        return res.status(404).json({ error: "Сервис эмбеддингов не найден" });
      }

      if (!provider.isActive) {
        return res.status(400).json({ error: "Выбранный сервис эмбеддингов отключён" });
      }

      const collectionName =
        requestedCollectionName && requestedCollectionName.trim().length > 0
          ? requestedCollectionName.trim()
          : buildCollectionName(site, provider, workspaceId);

      const normalizedSchemaFields: CollectionSchemaFieldInput[] = (schema?.fields ?? []).map(
        (field) => ({
          name: field.name.trim(),
          type: field.type,
          isArray: Boolean(field.isArray),
          template: field.template ?? "",
        }),
      );

      const existingWorkspaceId = await storage.getCollectionWorkspace(collectionName);
      if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
        return res.status(403).json({
          error: "Коллекция принадлежит другому рабочему пространству",
        });
      }

      const client = getQdrantClient();
      const shouldCreateCollection = Boolean(createCollection);
      let collectionExists = false;

      if (projectVectorizationManager.isRunning(siteId)) {
        return res.status(409).json({
          error: "Векторизация проекта уже выполняется",
        });
      }

      try {
        await client.getCollection(collectionName);
        collectionExists = true;
      } catch (collectionError) {
        const qdrantError = extractQdrantApiError(collectionError);
        if (qdrantError) {
          if (qdrantError.status === 404) {
            if (!shouldCreateCollection) {
              return res.status(404).json({
                error: `Коллекция ${collectionName} не найдена`,
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
        return res.status(404).json({
          error: `Коллекция ${collectionName} не найдена`,
        });
      }

      const status = projectVectorizationManager.startProjectVectorization({
        site,
        projectChunks,
        provider,
        collectionName,
        shouldCreateCollection,
        schemaFields: normalizedSchemaFields,
        client,
        collectionExists,
        workspaceId,
        existingWorkspaceId,
      });

      res.status(202).json({
        message: `Запущена векторизация проекта: ${status.totalRecords.toLocaleString("ru-RU")} записей`,
        status,
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные данные запроса",
          details: error.errors,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(`Ошибка Qdrant при отправке чанков проекта ${req.params.id}:`, error);
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(`Ошибка при отправке чанков проекта ${req.params.id} в Qdrant:`, error);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/sites/:id/vectorization-status", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }

    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const site = await storage.getSite(req.params.id, workspaceId);
      if (!site) {
        return res.status(404).json({ error: "Проект не найден" });
      }

      const status = projectVectorizationManager.getStatus(site.id);
      res.json({ status });
    } catch (error) {
      console.error(
        `Ошибка при получении статуса векторизации проекта ${req.params.id}:`,
        error,
      );
      res.status(500).json({ error: "Не удалось получить статус векторизации" });
    }
  });

  app.delete("/api/pages/:id", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const pageId = req.params.id;

      if (!pageId) {
        return res.status(400).json({ error: "Требуется идентификатор страницы" });
      }

      const { id: workspaceId } = getRequestWorkspace(req);
      const deleted = await storage.deletePage(pageId, workspaceId);

      if (!deleted) {
        return res.status(404).json({ error: "Страница не найдена" });
      }

      res.json({ message: "Страница успешно удалена" });
    } catch (error) {
      console.error("❌ Error deleting page:", error);
      res.status(500).json({ error: "Не удалось удалить страницу" });
    }
  });

  // Bulk delete pages
  app.delete("/api/pages/bulk-delete", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const validatedData = bulkDeletePagesSchema.parse(req.body);
      const { pageIds } = validatedData;

      console.log(`🗑️ Bulk delete requested for ${pageIds.length} pages`);

      const { id: workspaceId } = getRequestWorkspace(req);
      const deleteResults = await storage.bulkDeletePages(pageIds, workspaceId);
      
      console.log(`✅ Bulk delete completed: ${deleteResults.deletedCount} pages deleted`);
      
      res.json({ 
        message: "Pages deleted successfully",
        deletedCount: deleteResults.deletedCount,
        notFoundCount: deleteResults.notFoundCount,
        requestedCount: pageIds.length
      });
    } catch (error) {
      console.error("❌ Error in bulk delete:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ 
          error: "Failed to delete pages", 
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  // Statistics endpoint
  app.get("/api/stats", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const sites = await storage.getAllSites(workspaceId);
      const totalSites = sites.length;
      const activeCrawls = sites.filter(s => s.status === 'crawling').length;
      const completedCrawls = sites.filter(s => s.status === 'completed').length;
      const failedCrawls = sites.filter(s => s.status === 'failed').length;

      let totalPages = 0;
      for (const site of sites) {
        const pages = await storage.getPagesBySiteId(site.id, workspaceId);
        totalPages += pages.length;
      }

      res.json({
        sites: {
          total: totalSites,
          crawling: activeCrawls,
          completed: completedCrawls,
          failed: failedCrawls
        },
        pages: {
          total: totalPages
        }
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch statistics" });
    }
  });


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
      console.warn("[vector-health] QDRANT_URL не задан — Qdrant считается не настроенным");
      return res.json({
        ...basePayload,
        status: "not_configured" as const,
        error: "Переменная окружения QDRANT_URL не задана",
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

      console.error("[vector-health] Ошибка проверки подключения к Qdrant:", error, {
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
      console.log("🔍 Database health check requested");
      
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
      
      console.log("✅ Database health check:", JSON.stringify(healthInfo, null, 2));
      res.json(healthInfo);
    } catch (error) {
      console.error("❌ Database health check failed:", error);
      res.status(500).json({ 
        error: "Database health check failed",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });

  const httpServer = createServer(app);

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/crawler-logs",
  });

  type LogClient = {
    ws: WebSocket;
    siteId?: string | null;
  };

  const clients = new Set<LogClient>();

  wss.on("connection", (ws, req) => {
    let siteId: string | null | undefined;

    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "", `http://${host}`);
      siteId = url.searchParams.get("siteId");
    } catch (error) {
      console.warn("Crawler logs websocket: invalid connection attempt", error);
      ws.close(1008, "Invalid connection");
      return;
    }

    const client: LogClient = {
      ws,
      siteId,
    };
    clients.add(client);

    ws.send(
      JSON.stringify({
        type: "connected",
        siteId: siteId ?? null,
        timestamp: new Date().toISOString(),
      }),
    );

    ws.on("close", () => {
      clients.delete(client);
    });

    ws.on("error", () => {
      clients.delete(client);
    });
  });

  const broadcastLog = (event: CrawlLogEvent) => {
    const payload = JSON.stringify({ type: "log", data: event });

    for (const client of clients) {
      const shouldReceive = !client.siteId || client.siteId === event.siteId;
      if (!shouldReceive) {
        continue;
      }

      if (client.ws.readyState !== WebSocket.OPEN) {
        clients.delete(client);
        continue;
      }

      try {
        client.ws.send(payload);
      } catch (error) {
        console.warn("Failed to send crawler log to client", error);
        client.ws.terminate();
        clients.delete(client);
      }
    }
  };

  crawler.onLog(broadcastLog);

  return httpServer;
}

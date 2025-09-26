import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import fetch, {
  Headers,
  type Response as FetchResponse,
  type RequestInit as FetchRequestInit,
} from "node-fetch";
import { createHash, randomUUID } from "crypto";
import { Agent as HttpsAgent } from "https";
import { storage } from "./storage";
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
  userRoles,
  insertEmbeddingProviderSchema,
  updateEmbeddingProviderSchema,
  type PublicEmbeddingProvider,
  type EmbeddingProvider,
  type ContentChunk,
  type Site,
} from "@shared/schema";
import { requireAuth, requireAdmin, getSessionUser, toPublicUser } from "./auth";

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

function toPublicEmbeddingProvider(provider: EmbeddingProvider): PublicEmbeddingProvider {
  const { authorizationKey, ...rest } = provider;
  return {
    ...rest,
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

function buildCollectionName(site: Site | undefined, provider: EmbeddingProvider): string {
  const base = site?.id ?? provider.id;
  return `kb_${sanitizeCollectionName(base)}`;
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

const vectorizePageSchema = z.object({
  embeddingProviderId: z.string().uuid("Некорректный идентификатор сервиса эмбеддингов"),
  collectionName: z
    .string()
    .trim()
    .min(1, "Укажите название коллекции")
    .optional(),
  createCollection: z.boolean().optional(),
});

// Public search API request/response schemas
const publicSearchRequestSchema = z.object({
  query: z.string().min(1),
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

export async function registerRoutes(app: Express): Promise<Server> {
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

      res.json({ user: safeUser });
    } catch (error) {
      next(error);
    }
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
      const user = await storage.createUser({
        email,
        fullName,
        passwordHash,
      });

      const updatedUser = await storage.recordUserActivity(user.id);
      const safeUser = toPublicUser(updatedUser ?? user);
      req.logIn(safeUser, (error) => {
        if (error) {
          return next(error);
        }

        res.status(201).json({ user: safeUser });
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

        res.json({ user });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res, next) => {
    req.logout((error) => {
      if (error) {
        return next(error);
      }

      res.json({ success: true });
    });
  });

  app.use("/api", requireAuth);

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

  app.get("/api/embedding/services", requireAdmin, async (_req, res, next) => {
    try {
      const providers = await storage.listEmbeddingProviders();
      res.json({ providers: providers.map(toPublicEmbeddingProvider) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/embedding/services", requireAdmin, async (req, res) => {
    try {
      const payload = insertEmbeddingProviderSchema.parse(req.body);
      const provider = await storage.createEmbeddingProvider({
        ...payload,
        description: payload.description ?? null,
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

      const updated = await storage.updateEmbeddingProvider(providerId, updates);
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
      const deleted = await storage.deleteEmbeddingProvider(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Сервис не найден" });
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Vector search endpoints
  app.get("/api/vector/collections", async (_req, res) => {
    try {
      const client = getQdrantClient();
      const { collections } = await client.getCollections();

      const detailedCollections = await Promise.all(
        collections.map(async ({ name }) => {
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

      res.json({ collections: detailedCollections });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
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
        with_vector: false,
      });

      const points = result.points.map(({ vector: _vector, payload, ...rest }) => ({
        ...rest,
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
      const client = getQdrantClient();
      await client.deleteCollection(req.params.name);

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
      const sites = await storage.getAllSites(user.id);
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

      const newSite = await storage.createSite({
        ownerId: user.id,
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
      const sites = await storage.getAllSites(user.id);
      const sitesWithStats = await Promise.all(
        sites.map(async (site) => {
          const pages = await storage.getPagesBySiteId(site.id, user.id);
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
      const site = await storage.getSite(req.params.id, user.id);
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
      const updatedSite = await storage.updateSite(req.params.id, updates, user.id);
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

  app.delete("/api/sites/:id", async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) {
      return;
    }
    try {
      // Get site info before deletion for logging
      const siteToDelete = await storage.getSite(req.params.id, user.id);
      const success = await storage.deleteSite(req.params.id, user.id);
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
      const site = await storage.getSite(req.params.id, user.id);
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
      const site = await storage.getSite(req.params.id, user.id);
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
      const existingPages = await storage.getPagesBySiteId(req.params.id, user.id);
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
      const site = await storage.getSite(req.params.id, user.id);
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
      const pages = await storage.getPagesBySiteId(req.params.id, user.id);
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

      if (siteId) {
        console.log("📁 Filtering search by site:", siteId);
        const site = await storage.getSite(siteId, user.id);
        if (!site) {
          return res.status(404).json({ error: "Проект не найден" });
        }
        ({ results, total } = await storage.searchPagesByCollection(decodedQuery, siteId, limit, offset, user.id));
      } else {
        ({ results, total } = await storage.searchPages(decodedQuery, limit, offset, user.id));
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
      const sites = await storage.getAllSites(user.id);
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
      const allPages = await storage.getAllPages(user.id);
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
      const { embeddingProviderId, collectionName: requestedCollectionName, createCollection } =
        vectorizePageSchema.parse(req.body);
      const pageId = req.params.id;

      const page = await storage.getPage(pageId, user.id);
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

      const provider = await storage.getEmbeddingProvider(embeddingProviderId);
      if (!provider) {
        return res.status(404).json({ error: "Сервис эмбеддингов не найден" });
      }

      if (!provider.isActive) {
        return res.status(400).json({ error: "Выбранный сервис эмбеддингов отключён" });
      }

      const site: Site | undefined = await storage.getSite(page.siteId, user.id);
      const collectionName =
        requestedCollectionName && requestedCollectionName.trim().length > 0
          ? requestedCollectionName.trim()
          : buildCollectionName(site, provider);
      const chunkCharLimit = site?.maxChunkSize ?? null;
      const totalChunks = nonEmptyChunks.length;

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

      const points: Schemas["PointStruct"][] = embeddingResults.map((result) => {
        const { chunk, index, vector, usageTokens, embeddingId } = result;
        const baseChunkId = chunk.id && chunk.id.trim().length > 0
          ? chunk.id
          : `${page.id}-chunk-${chunk.metadata?.position ?? index}`;
        const pointId = normalizePointId(baseChunkId);
        const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
        const chunkWordCount = chunk.metadata?.wordCount ?? null;
        const chunkPosition = chunk.metadata?.position ?? index;

        const rawPayload = {
          pageId: page.id,
          pageUrl: page.url,
          pageTitle: page.title ?? null,
          pageMetadata: page.metadata ?? null,
          siteId: page.siteId,
          siteName: site?.name ?? null,
          siteUrl: site?.url ?? null,
          providerId: provider.id,
          providerName: provider.name,
          providerModel: provider.model,
          totalChunks,
          chunkCharLimit,
          chunkId: baseChunkId,
          chunkIndex: index,
          chunkHeading: chunk.heading ?? null,
          chunkLevel: chunk.level ?? null,
          chunkDeepLink: chunk.deepLink ?? null,
          chunkText: chunk.content,
          chunkCharCount,
          chunkWordCount,
          chunkPosition,
          chunkExcerpt: chunk.metadata?.excerpt ?? null,
          chunk: {
            id: baseChunkId,
            index,
            heading: chunk.heading ?? null,
            level: chunk.level ?? null,
            deepLink: chunk.deepLink ?? null,
            text: chunk.content,
            charCount: chunkCharCount,
            wordCount: chunkWordCount,
            metadata: chunk.metadata ?? null,
          },
          page: {
            id: page.id,
            url: page.url,
            title: page.title ?? null,
            totalChunks,
            chunkCharLimit,
            metadata: page.metadata ?? null,
          },
          site: site
            ? {
                id: site.id,
                name: site.name,
                url: site.url,
              }
            : null,
          embedding: {
            model: provider.model,
            vectorSize: vector.length,
            tokens: usageTokens ?? null,
            id: embeddingId ?? null,
          },
        };

        const payload = removeUndefinedDeep(rawPayload) as Record<string, unknown>;

        return {
          id: pointId,
          vector: vector as Schemas["PointStruct"]["vector"],
          payload,
        };
      });

      if (!collectionExists && shouldCreateCollection) {
        const firstVector = embeddingResults[0]?.vector;
        const vectorLength = Array.isArray(firstVector) ? firstVector.length : undefined;
        if (!vectorLength || vectorLength <= 0) {
          return res.status(500).json({
            error: "Не удалось определить размер вектора для новой коллекции",
          });
        }

        let distance: "Cosine" | "Euclid" | "Dot" | "Manhattan" = "Cosine";
        const configuredVectorSize = provider.qdrantConfig?.vectorSize;
        let vectorSizeForCreation = vectorLength;

        if (typeof configuredVectorSize === "number" && Number.isFinite(configuredVectorSize)) {
          vectorSizeForCreation = configuredVectorSize;
        } else if (typeof configuredVectorSize === "string") {
          const parsedSize = Number.parseInt(configuredVectorSize, 10);
          if (Number.isFinite(parsedSize) && parsedSize > 0) {
            vectorSizeForCreation = parsedSize;
          }
        }

        try {
          await client.createCollection(collectionName, {
            vectors: {
              size: vectorSizeForCreation,
              distance,
            },
          });
          collectionCreated = true;
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
        vectorSize: embeddingResults[0]?.vector.length ?? null,
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

      const deleted = await storage.deletePage(pageId, user.id);

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

      const deleteResults = await storage.bulkDeletePages(pageIds, user.id);
      
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
      const sites = await storage.getAllSites(user.id);
      const totalSites = sites.length;
      const activeCrawls = sites.filter(s => s.status === 'crawling').length;
      const completedCrawls = sites.filter(s => s.status === 'completed').length;
      const failedCrawls = sites.filter(s => s.status === 'failed').length;

      let totalPages = 0;
      for (const site of sites) {
        const pages = await storage.getPagesBySiteId(site.id, user.id);
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

import { db } from "./db";
import {
  models,
  type ModelType,
  type ModelConsumptionUnit,
  type ModelCostLevel,
  type InferInsertModel,
  type LlmModelOption,
  type LlmProvider,
  type EmbeddingProvider,
  type SpeechProvider,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { sanitizeLlmModelOptions } from "./llm-utils";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export class ModelValidationError extends Error {
  status = 400;
  code = "MODEL_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "ModelValidationError";
  }
}

export class ModelUnavailableError extends Error {
  status = 404;
  code = "MODEL_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export class ModelInactiveError extends Error {
  status = 409;
  code = "MODEL_INACTIVE";
  constructor(message: string) {
    super(message);
    this.name = "ModelInactiveError";
  }
}

export type ModelInput = {
  modelKey: string;
  displayName: string;
  description?: string | null;
  modelType: ModelType;
  consumptionUnit: ModelConsumptionUnit;
  costLevel?: ModelCostLevel;
  creditsPerUnit?: number;
  isActive?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  providerId?: string | null;
  providerType?: string | null;
  providerModelKey?: string | null;
};

function validateUnit(modelType: ModelType, unit: ModelConsumptionUnit) {
  if (modelType === "ASR" && unit !== "MINUTES") {
    throw new Error("ASR models must use MINUTES consumption unit");
  }
  if ((modelType === "LLM" || modelType === "EMBEDDINGS") && unit !== "TOKENS_1K") {
    throw new Error("LLM/EMBEDDINGS models must use TOKENS_1K consumption unit");
  }
}

function normalizeProvider(input: ModelInput | Partial<ModelInput>) {
  const providerId = input.providerId?.trim() || null;
  const providerType = input.providerType?.trim() || null;
  const providerModelKey = input.providerModelKey?.trim() || null;
  if (providerId && !providerModelKey) {
    throw new ModelValidationError("providerModelKey обязателен при указании providerId");
  }
  if (providerId && !providerType) {
    throw new ModelValidationError("providerType обязателен при указании providerId");
  }
  return { providerId, providerType, providerModelKey };
}

export async function listModels(opts?: {
  includeInactive?: boolean;
  type?: ModelType;
  providerId?: string | null;
  providerType?: string | null;
}): Promise<InferInsertModel<typeof models>[]> {
  const clauses = [];
  if (!opts?.includeInactive) {
    clauses.push(eq(models.isActive, true));
  }
  if (opts?.type) {
    clauses.push(eq(models.modelType, opts.type));
  }
  if (opts?.providerId) {
    clauses.push(eq(models.providerId, opts.providerId));
  }
  if (opts?.providerType) {
    clauses.push(eq(models.providerType, opts.providerType));
  }
  const where = clauses.length > 0 ? and(...clauses) : undefined;
  return db
    .select()
    .from(models)
    .where(where ?? sql`true`)
    .orderBy(models.sortOrder, models.displayName);
}

export async function createModel(input: ModelInput): Promise<InferInsertModel<typeof models>> {
  const modelKey = input.modelKey.trim();
  if (!modelKey) throw new Error("modelKey is required");
  validateUnit(input.modelType, input.consumptionUnit);
  const creditsPerUnitCents = Math.max(0, Math.trunc(input.creditsPerUnit ?? 0));
  const provider = normalizeProvider(input);
  const isActive = input.isActive ?? true;

  const [row] = await db
    .insert(models)
    .values({
      modelKey,
      displayName: input.displayName.trim(),
      description: input.description?.trim() ?? null,
      modelType: input.modelType,
      consumptionUnit: input.consumptionUnit,
      costLevel: input.costLevel ?? "MEDIUM",
      creditsPerUnit: creditsPerUnitCents,
      isActive,
      deletedAt: isActive ? null : sql`CURRENT_TIMESTAMP`,
      sortOrder: input.sortOrder ?? 0,
      metadata: (input.metadata as any) ?? {},
      providerId: provider.providerId,
      providerType: provider.providerType,
      providerModelKey: provider.providerModelKey,
    })
    .returning();
  return row;
}

export async function updateModel(
  id: string,
  input: Partial<ModelInput>,
): Promise<InferInsertModel<typeof models> | null> {
  const provider = normalizeProvider(input as ModelInput);
  const values: Partial<InferInsertModel<typeof models>> = {};
  if (input.modelKey !== undefined) {
    const nextKey = input.modelKey.trim();
    if (!nextKey) {
      throw new ModelValidationError("modelKey is required");
    }
    values.modelKey = nextKey;
  }
  if (input.displayName !== undefined) values.displayName = input.displayName.trim();
  if (input.description !== undefined) values.description = input.description?.trim() ?? null;
  if (input.modelType !== undefined) values.modelType = input.modelType;
  if (input.consumptionUnit !== undefined) values.consumptionUnit = input.consumptionUnit;
  if (input.costLevel !== undefined) values.costLevel = input.costLevel;
  if (input.creditsPerUnit !== undefined) values.creditsPerUnit = Math.max(0, Math.trunc(input.creditsPerUnit ?? 0));
  if (input.isActive !== undefined) {
    values.isActive = input.isActive;
    values.deletedAt = input.isActive ? null : sql`CURRENT_TIMESTAMP`;
  }
  if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder;
  if (input.metadata !== undefined) values.metadata = (input.metadata as any) ?? {};
  if (input.providerId !== undefined || input.providerModelKey !== undefined || input.providerType !== undefined) {
    values.providerId = provider.providerId;
    values.providerType = provider.providerType;
    values.providerModelKey = provider.providerModelKey;
  }

  if (values.modelType || values.consumptionUnit) {
    const type = (values.modelType as ModelType | undefined) ?? undefined;
    const unit = (values.consumptionUnit as ModelConsumptionUnit | undefined) ?? undefined;
    if (type && unit) validateUnit(type, unit);
  }

  const [row] = await db.update(models).set(values).where(eq(models.id, id)).returning();
  return row ?? null;
}

export async function getModelByKeyOrId(
  input: string,
  opts: { requireActive?: boolean } = {},
): Promise<InferInsertModel<typeof models> | null> {
  const trimmed = input.trim();
  const clauses = [];
  if (isValidUuid(trimmed)) {
    clauses.push(eq(models.id, trimmed));
  } else {
    clauses.push(eq(models.modelKey, trimmed));
  }
  if (opts.requireActive !== false) {
    clauses.push(eq(models.isActive, true));
  }
  const where = clauses.length > 1 ? and(...clauses) : clauses[0];
  const [row] = await db.select().from(models).where(where).limit(1);
  return row ?? null;
}

function assertModelType(model: InferInsertModel<typeof models>, expectedType?: ModelType) {
  if (expectedType && model.modelType !== expectedType) {
    throw new ModelValidationError(`Модель должна быть типа ${expectedType}`);
  }
}

export async function ensureModelAvailable(
  modelKeyOrId: string,
  opts: { expectedType?: ModelType; requireActive?: boolean } = {},
): Promise<InferInsertModel<typeof models>> {
  const trimmed = modelKeyOrId?.trim();
  if (!trimmed) {
    throw new ModelValidationError("Не указан идентификатор модели");
  }

  const model = await getModelByKeyOrId(trimmed, { requireActive: false });
  if (!model) {
    throw new ModelUnavailableError("Модель не найдена");
  }
  if (opts.requireActive !== false && !model.isActive) {
    throw new ModelInactiveError("Модель отключена");
  }

  assertModelType(model, opts.expectedType);
  return model;
}

export async function tryResolveModel(
  modelKeyOrId: string | null | undefined,
  opts: { expectedType?: ModelType; requireActive?: boolean } = {},
): Promise<InferInsertModel<typeof models> | null> {
  const trimmed = modelKeyOrId?.trim();
  if (!trimmed) return null;
  try {
    return await ensureModelAvailable(trimmed, opts);
  } catch (error) {
    if (error instanceof ModelValidationError) {
      throw error;
    }
    return null;
  }
}

type ProviderModelSpec = {
  providerId: string;
  providerType?: string | null;
  modelKey: string;
  displayName: string;
  modelType: ModelType;
  consumptionUnit: ModelConsumptionUnit;
  providerIsActive?: boolean;
};

async function upsertProviderModel(spec: ProviderModelSpec) {
  const normalizedKey = spec.modelKey.trim();
  const normalizedDisplayName = spec.displayName.trim() || normalizedKey;
  const normalizedType = spec.providerType?.trim() || null;

  const [existingByProvider] = await db
    .select()
    .from(models)
    .where(and(eq(models.providerId, spec.providerId), eq(models.providerModelKey, normalizedKey)))
    .limit(1);

  const [existingByKey] =
    existingByProvider === undefined
      ? await db.select().from(models).where(eq(models.modelKey, normalizedKey)).limit(1)
      : [undefined];

  const existing = existingByProvider ?? existingByKey ?? null;

  if (existing) {
    if (existing.providerId && existing.providerId !== spec.providerId) {
      console.warn(
        `[ModelSync] Модель ${normalizedKey} уже привязана к другому провайдеру (${existing.providerId}), пропускаем`,
      );
      return existing;
    }

    const shouldUpdateDisplayName =
      existing.providerId === spec.providerId || existing.displayName === existing.modelKey;

    const updates: Partial<InferInsertModel<typeof models>> = {};
    if (shouldUpdateDisplayName && existing.displayName !== normalizedDisplayName) {
      updates.displayName = normalizedDisplayName;
    }
    if (existing.modelType !== spec.modelType) updates.modelType = spec.modelType;
    if (existing.consumptionUnit !== spec.consumptionUnit) updates.consumptionUnit = spec.consumptionUnit;
    if (existing.providerId !== spec.providerId) updates.providerId = spec.providerId;
    if (existing.providerType !== normalizedType) updates.providerType = normalizedType;
    if (existing.providerModelKey !== normalizedKey) updates.providerModelKey = normalizedKey;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const [updated] = await db
      .update(models)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(models.id, existing.id))
      .returning();

    return updated ?? existing;
  }

  const [created] = await db
    .insert(models)
    .values({
      modelKey: normalizedKey,
      displayName: normalizedDisplayName,
      description: null,
      modelType: spec.modelType,
      consumptionUnit: spec.consumptionUnit,
      costLevel: "MEDIUM",
      creditsPerUnit: 0,
      isActive: spec.providerIsActive ?? true,
      sortOrder: 0,
      metadata: {} as Record<string, unknown>,
      providerId: spec.providerId,
      providerType: normalizedType,
      providerModelKey: normalizedKey,
    })
    .returning();

  return created;
}

export async function syncModelsWithLlmProvider(
  provider: Pick<LlmProvider, "id" | "providerType" | "availableModels" | "model" | "name" | "isActive">,
) {
  const availableModels: LlmModelOption[] = sanitizeLlmModelOptions(provider.availableModels);
  const modelsToSync = new Map<string, string>();

  for (const option of availableModels) {
    const key = option.value.trim();
    if (!key) continue;
    modelsToSync.set(key, option.label?.trim() || key);
  }

  const defaultModel = provider.model?.trim();
  if (defaultModel && !modelsToSync.has(defaultModel)) {
    modelsToSync.set(defaultModel, defaultModel);
  }

  if (modelsToSync.size === 0) {
    console.warn(
      `[ModelSync] У провайдера LLM ${provider.name} (${provider.id}) нет моделей для синхронизации. Добавьте availableModels или model.`,
    );
    return;
  }

  const syncedKeys = new Set<string>();
  for (const [modelKey, displayName] of modelsToSync.entries()) {
    await upsertProviderModel({
      providerId: provider.id,
      providerType: provider.providerType?.toUpperCase() ?? provider.providerType,
      modelKey,
      displayName,
      modelType: "LLM",
      consumptionUnit: "TOKENS_1K",
      providerIsActive: provider.isActive,
    });
    syncedKeys.add(modelKey);
  }

  const existingProviderModels = await db.select().from(models).where(eq(models.providerId, provider.id));
  for (const existing of existingProviderModels) {
    const key = existing.providerModelKey ?? "";
    if (!key) continue; // не трогаем старые записи без связки по ключу
    if (!syncedKeys.has(key) && existing.isActive) {
      await db
        .update(models)
        .set({ isActive: false, deletedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(models.id, existing.id));
    }
  }
}

export async function syncModelsWithEmbeddingProvider(
  provider: Pick<EmbeddingProvider, "id" | "providerType" | "model" | "name" | "isActive">,
) {
  const key = provider.model?.trim();
  if (!key) {
    console.warn(`[ModelSync] У провайдера эмбеддингов ${provider.name} (${provider.id}) не указана модель`);
    return;
  }

  await upsertProviderModel({
    providerId: provider.id,
    providerType: provider.providerType?.toUpperCase() ?? provider.providerType,
    modelKey: key,
    displayName: key,
    modelType: "EMBEDDINGS",
    consumptionUnit: "TOKENS_1K",
    providerIsActive: provider.isActive,
  });
}

export async function syncModelsWithSpeechProvider(opts: {
  provider: Pick<SpeechProvider, "id" | "providerType" | "displayName" | "isEnabled" | "direction">;
  config?: Record<string, unknown> | null;
}) {
  const { provider, config } = opts;
  if (provider.direction !== "audio_to_text") {
    return;
  }

  const configuredModel = typeof config?.model === "string" ? config.model.trim() : "";
  const fallbackKey = `asr-${provider.id}`;
  const modelKey = configuredModel || fallbackKey;
  if (!modelKey) return;

  const displayName = configuredModel ? `${provider.displayName} · ${configuredModel}` : provider.displayName;

  await upsertProviderModel({
    providerId: provider.id,
    providerType: provider.providerType?.toUpperCase() ?? provider.providerType,
    modelKey,
    displayName,
    modelType: "ASR",
    consumptionUnit: "MINUTES",
    providerIsActive: provider.isEnabled,
  });
}

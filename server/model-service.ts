import { db } from "./db";
import {
  models,
  type ModelType,
  type ModelConsumptionUnit,
  type ModelCostLevel,
  type InferInsertModel,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

export type ModelInput = {
  modelKey: string;
  displayName: string;
  description?: string | null;
  modelType: ModelType;
  consumptionUnit: ModelConsumptionUnit;
  costLevel?: ModelCostLevel;
  isActive?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
};

function validateUnit(modelType: ModelType, unit: ModelConsumptionUnit) {
  if (modelType === "ASR" && unit !== "MINUTES") {
    throw new Error("ASR models must use MINUTES consumption unit");
  }
  if ((modelType === "LLM" || modelType === "EMBEDDINGS") && unit !== "TOKENS_1K") {
    throw new Error("LLM/EMBEDDINGS models must use TOKENS_1K consumption unit");
  }
}

export async function listModels(opts?: { includeInactive?: boolean; type?: ModelType }): Promise<InferInsertModel<typeof models>[]> {
  const clauses = [];
  if (!opts?.includeInactive) {
    clauses.push(eq(models.isActive, true));
  }
  if (opts?.type) {
    clauses.push(eq(models.modelType, opts.type));
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

  const [row] = await db
    .insert(models)
    .values({
      modelKey,
      displayName: input.displayName.trim(),
      description: input.description?.trim() ?? null,
      modelType: input.modelType,
      consumptionUnit: input.consumptionUnit,
      costLevel: input.costLevel ?? "MEDIUM",
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      metadata: (input.metadata as any) ?? {},
    })
    .returning();
  return row;
}

export async function updateModel(
  id: string,
  input: Partial<Omit<ModelInput, "modelKey">>,
): Promise<InferInsertModel<typeof models> | null> {
  const values: Partial<InferInsertModel<typeof models>> = {};
  if (input.displayName !== undefined) values.displayName = input.displayName.trim();
  if (input.description !== undefined) values.description = input.description?.trim() ?? null;
  if (input.modelType !== undefined) values.modelType = input.modelType;
  if (input.consumptionUnit !== undefined) values.consumptionUnit = input.consumptionUnit;
  if (input.costLevel !== undefined) values.costLevel = input.costLevel;
  if (input.isActive !== undefined) values.isActive = input.isActive;
  if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder;
  if (input.metadata !== undefined) values.metadata = (input.metadata as any) ?? {};

  if (values.modelType || values.consumptionUnit) {
    const type = (values.modelType as ModelType | undefined) ?? undefined;
    const unit = (values.consumptionUnit as ModelConsumptionUnit | undefined) ?? undefined;
    if (type && unit) validateUnit(type, unit);
  }

  const [row] = await db.update(models).set(values).where(eq(models.id, id)).returning();
  return row ?? null;
}

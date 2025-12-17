import type { ModelConsumptionUnit, ModelType } from "@shared/schema";
import { ensureModelAvailable } from "./model-service";

export type UsageMeasurement = {
  unit: ModelConsumptionUnit;
  quantityRaw: number;
  quantityUnits: number;
  metadata?: Record<string, unknown>;
};

export type TokensUsage = { kind: "TOKENS"; tokens: number };
export type SecondsUsage = { kind: "SECONDS"; seconds: number };
export type RawUsageInput = TokensUsage | SecondsUsage;

export class UsageMeterError extends Error {
  code: "INVALID_USAGE_UNIT";
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>, status = 400) {
    super(message);
    this.name = "UsageMeterError";
    this.code = "INVALID_USAGE_UNIT";
    this.status = status;
    this.details = details;
  }
}

function normalizeNonNegativeInteger(value: number): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

/**
 * Конвертация токенов в единицы TOKENS_1K.
 * Округление: вверх до ближайшей тысячи (1..1000 => 1, 1001 => 2) — кредиты и ledger целочисленные.
 */
export function tokensToUnits(tokens: number): { raw: number; units: number } {
  const raw = normalizeNonNegativeInteger(tokens);
  const units = raw === 0 ? 0 : Math.ceil(raw / 1000);
  return { raw, units };
}

/**
 * Конвертация секунд в MINUTES.
 * Округление: вверх до целой минуты; 0 секунд -> 0 минут (поминутное списание для ASR).
 */
export function secondsToUnits(seconds: number): { raw: number; units: number } {
  const raw = normalizeNonNegativeInteger(seconds);
  const units = raw === 0 ? 0 : Math.ceil(raw / 60);
  return { raw, units };
}

export function buildMeasurement(
  unit: ModelConsumptionUnit,
  payload: { raw: number; units: number },
  metadata?: Record<string, unknown>,
): UsageMeasurement {
  return {
    unit,
    quantityRaw: payload.raw,
    quantityUnits: payload.units,
    metadata,
  };
}

function assertUsageMatchesUnit(unit: ModelConsumptionUnit, usage: RawUsageInput): void {
  if (unit === "TOKENS_1K" && usage.kind !== "TOKENS") {
    throw new UsageMeterError("Ожидаются токены для модели с unit TOKENS_1K", {
      expectedUnit: unit,
      received: usage.kind,
    });
  }
  if (unit === "MINUTES" && usage.kind !== "SECONDS") {
    throw new UsageMeterError("Ожидается длительность в секундах для модели с unit MINUTES", {
      expectedUnit: unit,
      received: usage.kind,
    });
  }
}

export function measureUsageForModel(
  model: { consumptionUnit: ModelConsumptionUnit },
  rawUsage: RawUsageInput,
  metadata?: Record<string, unknown>,
): UsageMeasurement {
  const unit = model.consumptionUnit;
  assertUsageMatchesUnit(unit, rawUsage);

  if (unit === "TOKENS_1K") {
    return buildMeasurement(unit, tokensToUnits((rawUsage as TokensUsage).tokens), metadata);
  }

  return buildMeasurement(unit, secondsToUnits((rawUsage as SecondsUsage).seconds), metadata);
}

export async function measureUsageByModelKeyOrId(
  modelKeyOrId: string,
  rawUsage: RawUsageInput,
  opts?: { expectedType?: ModelType; requireActive?: boolean; metadata?: Record<string, unknown> },
): Promise<{ model: { consumptionUnit: ModelConsumptionUnit }; measurement: UsageMeasurement }> {
  const model = await ensureModelAvailable(modelKeyOrId, {
    expectedType: opts?.expectedType,
    requireActive: opts?.requireActive,
  });

  const measurement = measureUsageForModel(model, rawUsage, opts?.metadata);
  return { model, measurement };
}

import { calculatePriceForUsage, type PriceCalculationResult } from "./price-calculator";
import { tokensToUnits, secondsToUnits, type UsageMeasurement } from "./consumption-meter";
import type { Model } from "@shared/schema";

export type LlmPreflightInput = {
  promptTokens: number;
  maxOutputTokens?: number | null;
};

export type EmbeddingPreflightInput = {
  inputTokens: number;
};

export type AsrPreflightInput = {
  durationSeconds: number;
};

export type PreflightEstimate = {
  unit: UsageMeasurement["unit"];
  estimatedRaw: number;
  estimatedUnits: number;
  estimatedCredits: number;
  appliedCreditsPerUnit: number;
  assumptions?: Record<string, unknown>;
};

function normalizeTokens(value: number | null | undefined): number {
  const numeric = Math.max(0, Math.floor(value ?? 0));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function estimateLlmPreflight(model: Pick<Model, "consumptionUnit" | "creditsPerUnit">, input: LlmPreflightInput): PreflightEstimate {
  const promptTokens = normalizeTokens(input.promptTokens);
  const maxOutputTokens = normalizeTokens(input.maxOutputTokens);
  const totalTokens = promptTokens + maxOutputTokens;
  const units = tokensToUnits(totalTokens);
  const price: PriceCalculationResult = calculatePriceForUsage(
    { consumptionUnit: model.consumptionUnit, creditsPerUnit: model.creditsPerUnit } as any,
    { unit: "TOKENS_1K", quantityRaw: units.raw, quantityUnits: units.units },
  );

  return {
    unit: "TOKENS_1K",
    estimatedRaw: units.raw,
    estimatedUnits: units.units,
    estimatedCredits: price.creditsCharged,
    appliedCreditsPerUnit: price.appliedCreditsPerUnit,
    assumptions: { promptTokens, maxOutputTokens },
  };
}

export function estimateEmbeddingsPreflight(
  model: Pick<Model, "consumptionUnit" | "creditsPerUnit">,
  input: EmbeddingPreflightInput,
): PreflightEstimate {
  const inputTokens = normalizeTokens(input.inputTokens);
  const units = tokensToUnits(inputTokens);
  const price: PriceCalculationResult = calculatePriceForUsage(
    { consumptionUnit: model.consumptionUnit, creditsPerUnit: model.creditsPerUnit } as any,
    { unit: "TOKENS_1K", quantityRaw: units.raw, quantityUnits: units.units },
  );

  return {
    unit: "TOKENS_1K",
    estimatedRaw: units.raw,
    estimatedUnits: units.units,
    estimatedCredits: price.creditsCharged,
    appliedCreditsPerUnit: price.appliedCreditsPerUnit,
    assumptions: { inputTokens },
  };
}

export function estimateAsrPreflight(
  model: Pick<Model, "consumptionUnit" | "creditsPerUnit">,
  input: AsrPreflightInput,
): PreflightEstimate {
  const duration = Math.max(0, Math.floor(input.durationSeconds ?? 0));
  const units = secondsToUnits(duration);
  const price: PriceCalculationResult = calculatePriceForUsage(
    { consumptionUnit: model.consumptionUnit, creditsPerUnit: model.creditsPerUnit } as any,
    { unit: "MINUTES", quantityRaw: units.raw, quantityUnits: units.units },
  );

  return {
    unit: "MINUTES",
    estimatedRaw: units.raw,
    estimatedUnits: units.units,
    estimatedCredits: price.creditsCharged,
    appliedCreditsPerUnit: price.appliedCreditsPerUnit,
    assumptions: { durationSeconds: duration },
  };
}

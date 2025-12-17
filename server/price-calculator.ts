import type { Model, ModelConsumptionUnit } from "@shared/schema";
import type { UsageMeasurement } from "./consumption-meter";
import { UsageMeterError } from "./consumption-meter";

export class PriceCalculationError extends Error {
  code: "PRICE_UNIT_MISMATCH";
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>, status = 400) {
    super(message);
    this.name = "PriceCalculationError";
    this.code = "PRICE_UNIT_MISMATCH";
    this.status = status;
    this.details = details;
  }
}

function assertUnitMatches(modelUnit: ModelConsumptionUnit, measurementUnit: ModelConsumptionUnit): void {
  if (modelUnit !== measurementUnit) {
    throw new PriceCalculationError("Единица потребления модели не совпадает с measurement", {
      expected: modelUnit,
      received: measurementUnit,
    });
  }
}

export type PriceCalculationResult = {
  creditsCharged: number;
  appliedCreditsPerUnit: number;
  unit: ModelConsumptionUnit;
  quantityUnits: number;
  quantityRaw: number;
};

export function calculatePriceForUsage(model: Pick<Model, "consumptionUnit" | "creditsPerUnit">, measurement: UsageMeasurement): PriceCalculationResult {
  assertUnitMatches(model.consumptionUnit, measurement.unit);
  if (measurement.quantityUnits < 0) {
    throw new UsageMeterError("quantityUnits не может быть отрицательным", { quantityUnits: measurement.quantityUnits });
  }
  const appliedCreditsPerUnit = Math.max(0, Math.floor(model.creditsPerUnit ?? 0));
  const creditsCharged = Math.max(0, Math.floor(measurement.quantityUnits)) * appliedCreditsPerUnit;

  return {
    creditsCharged,
    appliedCreditsPerUnit,
    unit: measurement.unit,
    quantityUnits: measurement.quantityUnits,
    quantityRaw: measurement.quantityRaw,
  };
}

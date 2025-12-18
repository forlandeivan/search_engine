import { describe, expect, it } from "vitest";
import { calculatePriceForUsage, PriceCalculationError } from "../server/price-calculator";
import type { UsageMeasurement } from "../server/consumption-meter";

const measurementTokens: UsageMeasurement = {
  unit: "TOKENS_1K",
  quantityRaw: 1500,
  quantityUnits: 2,
};

const measurementMinutes: UsageMeasurement = {
  unit: "MINUTES",
  quantityRaw: 125,
  quantityUnits: 3,
};

describe("PriceCalculator", () => {
  it("calculates credits for token-based model", () => {
    const result = calculatePriceForUsage(
      { consumptionUnit: "TOKENS_1K", creditsPerUnit: 1500 } as any,
      measurementTokens,
    );
    expect(result.creditsChargedCents).toBe(3000);
    expect(result.appliedCreditsPerUnitCents).toBe(1500);
  });

  it("calculates credits for minute-based model", () => {
    const result = calculatePriceForUsage(
      { consumptionUnit: "MINUTES", creditsPerUnit: 200 } as any,
      measurementMinutes,
    );
    expect(result.creditsChargedCents).toBe(600);
  });

  it("allows free models (creditsPerUnit=0)", () => {
    const result = calculatePriceForUsage(
      { consumptionUnit: "TOKENS_1K", creditsPerUnit: 0 } as any,
      measurementTokens,
    );
    expect(result.creditsChargedCents).toBe(0);
  });

  it("rejects unit mismatch", () => {
    expect(() =>
      calculatePriceForUsage({ consumptionUnit: "MINUTES", creditsPerUnit: 100 } as any, measurementTokens),
    ).toThrow(PriceCalculationError);
  });
});

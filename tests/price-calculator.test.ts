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
      { consumptionUnit: "TOKENS_1K", creditsPerUnit: 15 } as any,
      measurementTokens,
    );
    expect(result.creditsCharged).toBe(30);
    expect(result.appliedCreditsPerUnit).toBe(15);
  });

  it("calculates credits for minute-based model", () => {
    const result = calculatePriceForUsage(
      { consumptionUnit: "MINUTES", creditsPerUnit: 2 } as any,
      measurementMinutes,
    );
    expect(result.creditsCharged).toBe(6);
  });

  it("allows free models (creditsPerUnit=0)", () => {
    const result = calculatePriceForUsage(
      { consumptionUnit: "TOKENS_1K", creditsPerUnit: 0 } as any,
      measurementTokens,
    );
    expect(result.creditsCharged).toBe(0);
  });

  it("rejects unit mismatch", () => {
    expect(() =>
      calculatePriceForUsage({ consumptionUnit: "MINUTES", creditsPerUnit: 1 } as any, measurementTokens),
    ).toThrow(PriceCalculationError);
  });
});

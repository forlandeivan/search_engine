import { describe, expect, it } from "vitest";
import { buildMeasurement, secondsToUnits, tokensToUnits } from "../server/consumption-meter";

describe("tokensToUnits", () => {
  it("rounds up to the next 1k tokens block", () => {
    expect(tokensToUnits(0)).toEqual({ raw: 0, units: 0 });
    expect(tokensToUnits(1)).toEqual({ raw: 1, units: 1 });
    expect(tokensToUnits(999)).toEqual({ raw: 999, units: 1 });
    expect(tokensToUnits(1000)).toEqual({ raw: 1000, units: 1 });
    expect(tokensToUnits(1001)).toEqual({ raw: 1001, units: 2 });
  });

  it("clamps invalid or negative values to zero units", () => {
    expect(tokensToUnits(-10)).toEqual({ raw: 0, units: 0 });
    expect(tokensToUnits(Number.NaN)).toEqual({ raw: 0, units: 0 });
  });
});

describe("secondsToUnits", () => {
  it("rounds up to full minutes for ASR usage", () => {
    expect(secondsToUnits(0)).toEqual({ raw: 0, units: 0 });
    expect(secondsToUnits(1)).toEqual({ raw: 1, units: 1 });
    expect(secondsToUnits(59)).toEqual({ raw: 59, units: 1 });
    expect(secondsToUnits(60)).toEqual({ raw: 60, units: 1 });
    expect(secondsToUnits(61)).toEqual({ raw: 61, units: 2 });
  });

  it("handles negative and non-numeric inputs safely", () => {
    expect(secondsToUnits(-5)).toEqual({ raw: 0, units: 0 });
    expect(secondsToUnits(Number.NaN)).toEqual({ raw: 0, units: 0 });
  });
});

describe("buildMeasurement", () => {
  it("constructs usage measurement DTO", () => {
    const tokensMeasurement = buildMeasurement("TOKENS_1K", tokensToUnits(1500), { source: "test" });
    expect(tokensMeasurement).toEqual({
      unit: "TOKENS_1K",
      quantityRaw: 1500,
      quantityUnits: 2,
      metadata: { source: "test" },
    });
  });
});

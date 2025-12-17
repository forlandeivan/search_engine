import { describe, expect, it } from "vitest";
import {
  UsageMeterError,
  measureUsageForModel,
  type RawUsageInput,
  type UsageMeasurement,
} from "../server/consumption-meter";

function measurementOf(modelUnit: "TOKENS_1K" | "MINUTES", usage: RawUsageInput): UsageMeasurement {
  return measureUsageForModel({ consumptionUnit: modelUnit }, usage, { source: "test" });
}

describe("measureUsageForModel", () => {
  it("calculates tokens-based usage with ceil to 1k blocks", () => {
    const measurement = measurementOf("TOKENS_1K", { kind: "TOKENS", tokens: 1501 });
    expect(measurement).toEqual({
      unit: "TOKENS_1K",
      quantityRaw: 1501,
      quantityUnits: 2,
      metadata: { source: "test" },
    });
  });

  it("calculates minutes-based usage with ceil to whole minutes", () => {
    const measurement = measurementOf("MINUTES", { kind: "SECONDS", seconds: 61 });
    expect(measurement).toEqual({
      unit: "MINUTES",
      quantityRaw: 61,
      quantityUnits: 2,
      metadata: { source: "test" },
    });
  });

  it("rejects mismatched usage vs unit for token models", () => {
    expect(() => measurementOf("TOKENS_1K", { kind: "SECONDS", seconds: 30 })).toThrow(UsageMeterError);
    try {
      measurementOf("TOKENS_1K", { kind: "SECONDS", seconds: 30 });
    } catch (error: any) {
      expect(error.code).toBe("INVALID_USAGE_UNIT");
    }
  });

  it("rejects mismatched usage vs unit for minute models", () => {
    expect(() => measurementOf("MINUTES", { kind: "TOKENS", tokens: 10 })).toThrow(UsageMeterError);
  });
});

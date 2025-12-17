import { describe, expect, it } from "vitest";
import { estimateLlmPreflight, estimateEmbeddingsPreflight, estimateAsrPreflight } from "../server/preflight-estimator";

const tokenModel = { consumptionUnit: "TOKENS_1K", creditsPerUnit: 10 } as any;
const minuteModel = { consumptionUnit: "MINUTES", creditsPerUnit: 3 } as any;

describe("Preflight estimator", () => {
  it("LLM adds max output tokens and rounds up to 1k blocks", () => {
    const result = estimateLlmPreflight(tokenModel, { promptTokens: 1500, maxOutputTokens: 600 });
    expect(result.estimatedRaw).toBe(2100);
    expect(result.estimatedUnits).toBe(3);
    expect(result.estimatedCredits).toBe(30);
  });

  it("Embeddings uses input tokens only", () => {
    const result = estimateEmbeddingsPreflight(tokenModel, { inputTokens: 999 });
    expect(result.estimatedUnits).toBe(1);
    expect(result.estimatedCredits).toBe(10);
  });

  it("ASR converts seconds to minutes with ceil", () => {
    const result = estimateAsrPreflight(minuteModel, { durationSeconds: 61 });
    expect(result.estimatedUnits).toBe(2);
    expect(result.estimatedCredits).toBe(6);
  });
});

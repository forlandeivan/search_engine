import { describe, expect, it } from "vitest";

import {
  applyRetrievalPostProcessing,
  resolveEffectiveRetrievalParams,
  type KnowledgeBaseRagCombinedChunk,
} from "../server/routes";
import { DEFAULT_INDEXING_RULES, MAX_TOP_K } from "@shared/indexing-rules";

const sampleResults: KnowledgeBaseRagCombinedChunk[] = [
  {
    chunkId: "c1",
    documentId: "d1",
    docTitle: "Doc 1",
    sectionTitle: null,
    text: "text-1",
    snippet: "s1",
    bm25Score: 1,
    vectorScore: 1,
    bm25Normalized: 1,
    vectorNormalized: 1,
    combinedScore: 0.9,
    nodeId: null,
    nodeSlug: null,
  },
  {
    chunkId: "c2",
    documentId: "d2",
    docTitle: "Doc 2",
    sectionTitle: null,
    text: "text-2",
    snippet: "s2",
    bm25Score: 0.8,
    vectorScore: 0.8,
    bm25Normalized: 0.8,
    vectorNormalized: 0.8,
    combinedScore: 0.7,
    nodeId: null,
    nodeSlug: null,
  },
  {
    chunkId: "c3",
    documentId: "d3",
    docTitle: "Doc 3",
    sectionTitle: null,
    text: "text-3",
    snippet: "s3",
    bm25Score: 0.6,
    vectorScore: 0.6,
    bm25Normalized: 0.6,
    vectorNormalized: 0.6,
    combinedScore: 0.4,
    nodeId: null,
    nodeSlug: null,
  },
];

describe("resolveEffectiveRetrievalParams", () => {
  it("использует глобальные правила для навыковых запросов", () => {
    const result = resolveEffectiveRetrievalParams({
      bodyTopK: 3,
      rulesTopK: 8,
      rulesRelevanceThreshold: 0.55,
      hasExplicitTopKOverride: true,
      skillId: "skill-1",
    });

    expect(result.topK).toBe(8);
    expect(result.minScore).toBeCloseTo(0.55);
  });

  it("позволяет переопределение top_k в явном запросе без skill_id", () => {
    const result = resolveEffectiveRetrievalParams({
      bodyTopK: 3,
      rulesTopK: 8,
      rulesRelevanceThreshold: DEFAULT_INDEXING_RULES.relevanceThreshold,
      hasExplicitTopKOverride: true,
      skillId: null,
    });

    expect(result.topK).toBe(3);
  });
});

describe("applyRetrievalPostProcessing", () => {
  it("ограничивает количество результатов значением topK", () => {
    const single = applyRetrievalPostProcessing({
      combinedResults: sampleResults,
      topK: 1,
      minScore: 0,
      estimateTokens: (text) => text.length,
    });
    const many = applyRetrievalPostProcessing({
      combinedResults: sampleResults,
      topK: MAX_TOP_K,
      minScore: 0,
      estimateTokens: (text) => text.length,
    });

    expect(single.combinedResults).toHaveLength(1);
    expect(many.combinedResults).toHaveLength(sampleResults.length);
  });

  it("отфильтровывает результаты по порогу", () => {
    const result = applyRetrievalPostProcessing({
      combinedResults: sampleResults,
      topK: MAX_TOP_K,
      minScore: 0.8,
      estimateTokens: (text) => text.length,
    });

    expect(result.combinedResults.length).toBe(1);
    expect(result.combinedResults[0]?.combinedScore).toBeCloseTo(0.9);
  });
});

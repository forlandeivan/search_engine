import { describe, expect, it } from "vitest";
import { __test__ } from "../server/knowledge-chunks";

const buildRepeatedWords = (count: number): string => {
  return Array.from({ length: count }, (_, index) => `token-${index + 1}`).join(" ");
};

describe("knowledge chunk generation limits", () => {
  it("does not exceed token limit even for a single very long sentence", () => {
    const html = `<p>${buildRepeatedWords(317)}</p>`;
    const { sentences, normalizedText } = __test__.extractSentences(html);
    const config = __test__.normalizeChunkingConfig({
      maxTokens: 200,
      overlapTokens: 0,
      overlapChars: 0,
      respectHeadings: false,
      splitByPages: false,
    });

    const chunks = __test__.generateChunks(sentences, normalizedText, config, null);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }
  });
});

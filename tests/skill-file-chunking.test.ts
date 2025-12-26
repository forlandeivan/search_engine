import { describe, expect, it } from "vitest";
import { chunkSkillFileText, ChunkingError, MAX_CHUNKS_PER_FILE } from "../server/skill-file-chunking";

describe("skill file chunking", () => {
  it("splits text deterministically with overlap", () => {
    const text = "abcdefghij".repeat(40); // 400 chars
    const { chunks, totalChars } = chunkSkillFileText({
      text,
      chunkSize: 240,
      chunkOverlap: 60,
      fileId: "file-1",
      fileVersion: 1,
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text.length).toBeLessThanOrEqual(240);
    expect(chunks[0].end - chunks[0].start).toBeLessThanOrEqual(240);
    if (chunks.length > 1) {
      const firstEnd = chunks[0].end;
      const secondStart = chunks[1].start;
      expect(firstEnd - secondStart).toBeLessThanOrEqual(240); // with overlap step
    }
    // deterministic ids
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // totals
    expect(totalChars).toBeGreaterThan(0);
  });

  it("throws on invalid settings", () => {
    expect(() =>
      chunkSkillFileText({
        text: "hello world",
        chunkSize: 200,
        chunkOverlap: 300,
        fileId: "file-1",
        fileVersion: 1,
      }),
    ).toThrow(ChunkingError);
  });

  it("throws on too many chunks", () => {
    const longText = "a".repeat((MAX_CHUNKS_PER_FILE + 1) * 210); // min chunk size 200
    expect(() =>
      chunkSkillFileText({
        text: longText,
        chunkSize: 200,
        chunkOverlap: 0,
        fileId: "file-1",
        fileVersion: 1,
      }),
    ).toThrow(ChunkingError);
  });
});

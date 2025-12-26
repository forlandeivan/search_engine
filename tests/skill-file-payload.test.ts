import { describe, expect, it } from "vitest";

import {
  buildSkillFileChunkPayload,
  buildSkillFileVectorFilter,
  SKILL_FILE_SOURCE,
} from "../server/skill-file-payload";

describe("skill file payload builder", () => {
  it("строит обязательные поля payload", () => {
    const payload = buildSkillFileChunkPayload({
      workspaceId: "ws1",
      skillId: "skill1",
      fileId: "file1",
      fileVersion: 2,
      chunkId: "chunk-1",
      chunkIndex: 0,
      text: "hello",
      originalName: "doc.pdf",
    });

    expect(payload).toEqual({
      workspace_id: "ws1",
      skill_id: "skill1",
      doc_id: "file1",
      doc_version: 2,
      source: SKILL_FILE_SOURCE,
      chunk_id: "chunk-1",
      chunk_index: 0,
      chunk_text: "hello",
      original_name: "doc.pdf",
    });
  });

  it("строит фильтр delete по workspace/skill/doc/version", () => {
    const filter = buildSkillFileVectorFilter({
      workspaceId: "ws1",
      skillId: "skill1",
      fileId: "file1",
      fileVersion: 3,
    });

    expect(filter.must).toEqual([
      { key: "workspace_id", match: { value: "ws1" } },
      { key: "skill_id", match: { value: "skill1" } },
      { key: "doc_id", match: { value: "file1" } },
      { key: "doc_version", match: { value: 3 } },
    ]);
  });

  it("строит фильтр поиска по workspace/skill без doc_id", () => {
    const filter = buildSkillFileVectorFilter({
      workspaceId: "ws1",
      skillId: "skill1",
    });

    expect(filter.must).toEqual([
      { key: "workspace_id", match: { value: "ws1" } },
      { key: "skill_id", match: { value: "skill1" } },
    ]);
  });
});

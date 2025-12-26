/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { searchSkillFileVectors } from "../server/skill-file-vector-store";
import { storage } from "../server/storage";

vi.mock("../server/qdrant", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../server/qdrant");
  let mockClient: Partial<QdrantClient> | null = null;
  return {
    ...(actual as Record<string, unknown>),
    getQdrantClient: () => {
      if (!mockClient) {
        throw new Error("Mock Qdrant client not set");
      }
      return mockClient as QdrantClient;
    },
    __setMockQdrantClient: (client: Partial<QdrantClient>) => {
      mockClient = client;
    },
  };
});

// @ts-expect-error mock helper is injected by vi.mock
import { __setMockQdrantClient } from "../server/qdrant";

describe("searchSkillFileVectors", () => {
  const workspaceId = "ws-test";
  const skillId = "skill-1";
  const provider = {
    id: "prov-1",
    qdrantConfig: { collectionName: "custom-coll" },
  } as any;

  beforeEach(() => {
    __setMockQdrantClient(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("вызывает поиск по коллекции workspace с фильтром по workspace/skill", async () => {
    const search = vi.fn().mockResolvedValue([
      { id: "p1", score: 0.9, payload: { chunk_id: "c1" } },
    ]);
    const getCollectionWorkspace = vi
      .spyOn(storage, "getCollectionWorkspace")
      .mockResolvedValue(workspaceId);

    __setMockQdrantClient({ search });

    const result = await searchSkillFileVectors({
      workspaceId,
      skillId,
      provider,
      vector: [0.1, 0.2],
      limit: 5,
    });

    expect(result.collection).toBe("custom-coll");
    expect(result.guardrailTriggered).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("custom-coll", {
      vector: [0.1, 0.2],
      limit: 5,
      filter: {
        must: [
          { key: "workspace_id", match: { value: workspaceId } },
          { key: "skill_id", match: { value: skillId } },
        ],
      },
      with_payload: true,
      with_vector: false,
    });
    getCollectionWorkspace.mockRestore();
  });

  it("возвращает пустой ответ и не зовет поиск, если workspaceId отсутствует", async () => {
    const search = vi.fn();
    vi.spyOn(storage, "getCollectionWorkspace").mockResolvedValue(null);
    __setMockQdrantClient({ search });

    const result = await searchSkillFileVectors({
      workspaceId: "",
      skillId,
      provider,
      vector: [1, 2],
      limit: 3,
    });
    expect(result.guardrailTriggered).toBe(true);
    expect(result.results).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });
});

/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { deleteSkillFileVectors, VectorStoreError } from "../server/skill-file-vector-store";

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

// @ts-expect-error mock helper injected by vi.mock
import { __setMockQdrantClient } from "../server/qdrant";

describe("deleteSkillFileVectors", () => {
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

  it("удаляет по фильтру workspace+skill+doc одним запросом", async () => {
    const getCollection = vi.fn().mockResolvedValue({});
    const deleteFn = vi.fn().mockResolvedValue({});
    __setMockQdrantClient({ getCollection, delete: deleteFn });

    await deleteSkillFileVectors({
      workspaceId: "ws-1",
      skillId: "skill-1",
      fileId: "doc-1",
      provider,
    });

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledWith("custom-coll", {
      wait: true,
      points: undefined,
      filter: {
        must: [
          { key: "workspace_id", match: { value: "ws-1" } },
          { key: "skill_id", match: { value: "skill-1" } },
          { key: "doc_id", match: { value: "doc-1" } },
        ],
      },
    });
  });

  it("кидает ошибку при отсутствии обязательных параметров", async () => {
    const deleteFn = vi.fn();
    __setMockQdrantClient({ delete: deleteFn, getCollection: vi.fn() });

    await expect(
      deleteSkillFileVectors({
        workspaceId: "",
        skillId: "",
        fileId: "",
        provider,
      }),
    ).rejects.toBeInstanceOf(VectorStoreError);
    expect(deleteFn).not.toHaveBeenCalled();
  });
});

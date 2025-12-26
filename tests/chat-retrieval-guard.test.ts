import { describe, expect, it, vi, beforeEach } from "vitest";
import { __chatServiceTestUtils } from "../server/chat-service";

vi.mock("../server/indexing-rules", () => ({
  resolveEmbeddingProviderForWorkspace: vi.fn().mockResolvedValue({
    provider: { id: "prov-1", qdrantConfig: {} },
    rules: { topK: 3, relevanceThreshold: 0.2 },
  }),
}));

vi.mock("../server/skill-file-embeddings", () => ({
  embedTextWithProvider: vi.fn().mockResolvedValue({ vector: [0.1, 0.2, 0.3] }),
}));

vi.mock("../server/skill-file-vector-store", () => ({
  searchSkillFileVectors: vi.fn().mockResolvedValue({
    guardrailTriggered: false,
    collection: "ws_coll",
    results: [
      { score: 0.9, payload: { doc_id: "doc-ready", chunk_text: "ALPHA_ONLY content" } },
    ],
  }),
}));

vi.mock("../server/storage", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../server/storage");
  return {
    ...(actual as Record<string, unknown>),
    storage: {
      ...(actual as any).storage,
      listReadySkillFileIds: vi.fn().mockResolvedValue(["doc-ready"]),
    },
  };
});

describe("chat retrieval guardrails", () => {
  const skill = {
    id: "skill-1",
    name: "Test skill",
    isSystem: false,
    systemKey: null,
    ragConfig: { embeddingProviderId: "prov-1" },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("вызывает поиск с workspace+skill и использует только READY документы", async () => {
    const fragments = await __chatServiceTestUtils.buildSkillRetrievalContext({
      workspaceId: "ws-1",
      skill,
      userMessage: "alpha?",
    });

    expect(fragments).toEqual(["ALPHA_ONLY content"]);

    const searchSkillFileVectors = await import("../server/skill-file-vector-store").then(
      (m) => (m as any).searchSkillFileVectors as ReturnType<typeof vi.fn>,
    );
    expect(searchSkillFileVectors).toHaveBeenCalledTimes(1);
    expect(searchSkillFileVectors).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", skillId: "skill-1" }),
    );
  });

  it("отбрасывает результаты чужих документов (не READY)", async () => {
    const storage = (await import("../server/storage")) as any;
    storage.storage.listReadySkillFileIds.mockResolvedValueOnce(["doc-ready"]);

    const searchSkillFileVectors = await import("../server/skill-file-vector-store").then(
      (m) => (m as any).searchSkillFileVectors as ReturnType<typeof vi.fn>,
    );
    searchSkillFileVectors.mockResolvedValueOnce({
      guardrailTriggered: false,
      collection: "ws_coll",
      results: [{ score: 0.9, payload: { doc_id: "foreign-doc", chunk_text: "BETA_ONLY" } }],
    });

    const fragments = await __chatServiceTestUtils.buildSkillRetrievalContext({
      workspaceId: "ws-1",
      skill,
      userMessage: "beta?",
    });

    expect(fragments).toBeNull();
  });

  it("деградирует по таймауту и не кидает ошибку наружу", async () => {
    vi.useFakeTimers();
    const searchSkillFileVectors = await import("../server/skill-file-vector-store").then(
      (m) => (m as any).searchSkillFileVectors as ReturnType<typeof vi.fn>,
    );
    searchSkillFileVectors.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ guardrailTriggered: false, results: [] }), 2000)),
    );

    const fragmentsPromise = __chatServiceTestUtils.buildSkillRetrievalContext({
      workspaceId: "ws-1",
      skill,
      userMessage: "slow",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const fragments = await fragmentsPromise;
    expect(fragments).toBeNull();
    vi.useRealTimers();
  });
});

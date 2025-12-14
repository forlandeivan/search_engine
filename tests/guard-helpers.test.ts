import { buildLlmOperationContext, buildEmbeddingsOperationContext, buildAsrOperationContext, buildStorageUploadOperationContext } from "../server/guards/helpers";

describe("guard context builders", () => {
  it("builds LLM context with expectedCost tokens and scenario", () => {
    const ctx = buildLlmOperationContext({
      workspaceId: "ws-1",
      providerId: "prov",
      model: "m",
      scenario: "chat",
      tokens: 128,
    });
    expect(ctx.operationType).toBe("LLM_REQUEST");
    expect(ctx.expectedCost?.tokens).toBe(128);
    expect(ctx.meta?.llm?.scenario).toBe("chat");
  });

  it("builds Embeddings context with collection meta", () => {
    const ctx = buildEmbeddingsOperationContext({
      workspaceId: "ws-1",
      providerId: "prov",
      model: "emb",
      scenario: "query_embedding",
      tokens: 42,
      collection: "col-1",
    });
    expect(ctx.operationType).toBe("EMBEDDINGS");
    expect(ctx.expectedCost?.tokens).toBe(42);
    expect(ctx.meta?.objects?.parentId).toBe("col-1");
  });

  it("builds ASR context with seconds", () => {
    const ctx = buildAsrOperationContext({
      workspaceId: "ws-1",
      providerId: "prov",
      model: "asr",
      mediaType: "audio",
      durationSeconds: 90,
    });
    expect(ctx.operationType).toBe("ASR_TRANSCRIPTION");
    expect(ctx.expectedCost?.seconds).toBe(90);
    expect(ctx.meta?.asr?.mediaType).toBe("audio");
  });

  it("builds Storage upload context with bytes and category", () => {
    const ctx = buildStorageUploadOperationContext({
      workspaceId: "ws-1",
      fileName: "icon.png",
      mimeType: "image/png",
      category: "icon",
      sizeBytes: 2048,
    });
    expect(ctx.operationType).toBe("STORAGE_UPLOAD");
    expect(ctx.expectedCost?.bytes).toBe(2048);
    expect(ctx.meta?.storage?.category).toBe("icon");
  });
});

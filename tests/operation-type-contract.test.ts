import { OPERATION_TYPES } from "../server/guards/types";

describe("OperationType contract", () => {
  it("matches the expected stable list", () => {
    expect(OPERATION_TYPES).toEqual([
      "LLM_REQUEST",
      "EMBEDDINGS",
      "ASR_TRANSCRIPTION",
      "STORAGE_UPLOAD",
      "CREATE_SKILL",
      "CREATE_KNOWLEDGE_BASE",
      "CREATE_ACTION",
      "INVITE_WORKSPACE_MEMBER",
    ]);
  });
});

import type { OperationContext } from "./types";

type LlmContextInput = {
  workspaceId: string;
  providerId: string;
  model?: string | null;
  modelId?: string | null;
  modelKey?: string | null;
  stream?: boolean;
  scenario?: "chat" | "skill" | "pipeline" | "generation" | string;
  tokens?: number;
};

export function buildLlmOperationContext(input: LlmContextInput): OperationContext {
  return {
    workspaceId: input.workspaceId,
    operationType: "LLM_REQUEST",
    expectedCost: input.tokens && Number.isFinite(input.tokens) ? { tokens: input.tokens } : undefined,
    meta: {
      llm: {
        provider: input.providerId,
        model: input.model ?? null,
        modelId: input.modelId ?? null,
        modelKey: input.modelKey ?? null,
        scenario: input.scenario ?? "chat",
      },
    },
  };
}

type EmbeddingsContextInput = {
  workspaceId: string;
  providerId?: string | null;
  model?: string | null;
  modelId?: string | null;
  modelKey?: string | null;
  scenario?: "document_vectorization" | "query_embedding" | string;
  tokens?: number;
  bytes?: number;
  objects?: number;
  collection?: string | null;
};

export function buildEmbeddingsOperationContext(input: EmbeddingsContextInput): OperationContext {
  const expected = {
    tokens: input.tokens,
    bytes: input.bytes,
    objects: input.objects,
  };
  const hasCost = Object.values(expected).some((v) => Number.isFinite(v as number));

  return {
    workspaceId: input.workspaceId,
    operationType: "EMBEDDINGS",
    expectedCost: hasCost ? expected : undefined,
    meta: {
      embeddings: {
        provider: input.providerId ?? null,
        model: input.model ?? null,
        modelId: input.modelId ?? null,
        modelKey: input.modelKey ?? null,
        scenario: input.scenario ?? "document_vectorization",
      },
      objects: input.collection ? { entityType: "collection", parentId: input.collection } : undefined,
    },
  };
}

type AsrContextInput = {
  workspaceId: string;
  providerId?: string | null;
  model?: string | null;
  modelId?: string | null;
  modelKey?: string | null;
  mediaType?: "audio" | "video" | string;
  durationSeconds?: number;
};

export function buildAsrOperationContext(input: AsrContextInput): OperationContext {
  return {
    workspaceId: input.workspaceId,
    operationType: "ASR_TRANSCRIPTION",
    expectedCost:
      input.durationSeconds && Number.isFinite(input.durationSeconds) ? { seconds: input.durationSeconds } : undefined,
    meta: {
      asr: {
        provider: input.providerId ?? null,
        model: input.model ?? null,
        modelId: input.modelId ?? null,
        modelKey: input.modelKey ?? null,
        mediaType: input.mediaType ?? "audio",
        durationSeconds: input.durationSeconds,
      },
    },
  };
}

type StorageContextInput = {
  workspaceId: string;
  fileName?: string | null;
  mimeType?: string | null;
  category?: "kb_document" | "chat_attachment" | "icon" | string;
  sizeBytes?: number;
};

export function buildStorageUploadOperationContext(input: StorageContextInput): OperationContext {
  return {
    workspaceId: input.workspaceId,
    operationType: "STORAGE_UPLOAD",
    expectedCost:
      input.sizeBytes !== undefined && input.sizeBytes !== null && Number.isFinite(input.sizeBytes)
        ? { bytes: input.sizeBytes }
        : undefined,
    meta: {
      storage: {
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        category: input.category ?? "chat_attachment",
        sizeBytes: input.sizeBytes,
      },
    },
  };
}

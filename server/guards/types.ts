// OperationType — что за операция хотим выполнить (MVP набор для лимитов/guard).
// Детализацию (chat/skill/pipeline и т.п.) передаём в meta.scenario.
export const OPERATION_TYPES = [
  "LLM_REQUEST", // Вызов LLM: chat/skill/pipeline/generation — meta.llm.scenario, provider/model
  "EMBEDDINGS", // Построение векторов: document_vectorization / query_embedding — meta.embeddings.scenario
  "ASR_TRANSCRIPTION", // Создание ASR-задачи — meta.asr.mediaType/durationSeconds/provider/model
  "STORAGE_UPLOAD", // Загрузка файла в MinIO/S3 — meta.storage.mimeType/category/sizeBytes
  "CREATE_SKILL", // Создание навыка
  "CREATE_KNOWLEDGE_BASE", // Создание базы знаний/коллекции
  "CREATE_ACTION", // Создание action внутри skill/workspace
  "INVITE_WORKSPACE_MEMBER", // Приглашение/добавление участника
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export type BlockReasonCode =
  | "ALLOWED"
  | "USAGE_LIMIT_REACHED"
  | "OPERATION_NOT_ALLOWED"
  | "PLAN_RESTRICTED"
  | "WORKSPACE_SUSPENDED"
  | "UNKNOWN";

export type ResourceType = "tokens" | "embeddings" | "asr" | "storage" | "objects" | "other";

export const LIMIT_KEYS = [
  "TOKEN_LLM",
  "TOKEN_EMBEDDINGS",
  "ASR_MINUTES",
  "STORAGE_BYTES",
  "OBJECT_SKILLS",
  "OBJECT_KNOWLEDGE_BASES",
  "OBJECT_ACTIONS",
  "OBJECT_MEMBERS",
  "QDRANT_BYTES",
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export type ExpectedCost = {
  tokens?: number;
  bytes?: number;
  seconds?: number;
  objects?: number;
  custom?: { label: string; value: number };
};

export type LimitRule = {
  limitKey: LimitKey;
  resourceType: ResourceType;
  unit: "tokens" | "bytes" | "minutes" | "count";
  limitValue: number | null; // null => unlimited
  scope: "workspace";
  appliesTo?: {
    operationType?: OperationType;
    scenario?: string;
    provider?: string;
    model?: string;
  };
  upgradeAvailable?: boolean;
};

export type LimitCheckResult = {
  exceeded: boolean;
  current: number;
  predicted: number;
  limit: number | null;
  limitKey: LimitKey;
  unit: LimitRule["unit"];
};

export type OperationContext = {
  workspaceId: string;
  operationType: OperationType;
  expectedCost?: ExpectedCost | null;
  meta?: {
    llm?: {
      provider?: string | null;
      model?: string | null;
      scenario?: "chat" | "skill" | "pipeline" | "generation" | string;
    };
    embeddings?: {
      provider?: string | null;
      model?: string | null;
      scenario?: "document_vectorization" | "query_embedding" | string;
    };
    asr?: {
      provider?: string | null;
      model?: string | null;
      mediaType?: "audio" | "video" | string;
      durationSeconds?: number;
    };
    storage?: {
      fileName?: string | null;
      mimeType?: string | null;
      category?: "kb_document" | "chat_attachment" | "icon" | string;
      sizeBytes?: number;
    };
    objects?: {
      entityType?: "skill" | "knowledge_base" | "action" | "member" | string;
      parentId?: string | null;
    };
    [key: string]: unknown;
  };
};

export type GuardDecision = {
  allowed: boolean;
  reasonCode: BlockReasonCode;
  resourceType: ResourceType | null;
  message: string;
  upgradeAvailable: boolean;
  limitsHint?: { current?: number; limit?: number | null; unit?: string; limitKey?: LimitKey };
  debug?: Record<string, unknown> | null;
};

export type OperationBlockedPayload = {
  reasonCode: BlockReasonCode;
  resourceType: ResourceType;
  message: string;
  upgradeAvailable: boolean;
  operationType?: OperationType;
  workspaceId?: string;
  limitsHint?: { current?: number; limit?: number | null; unit?: string };
  meta?: Record<string, unknown>;
  correlationId?: string;
};

export type LimitRulesProvider = {
  getRules: (workspaceId: string, context: OperationContext) => Promise<LimitRule[]>;
};

export type UsageSnapshotProvider<Snapshot = unknown> = {
  getSnapshot: (workspaceId: string) => Promise<Snapshot>;
};

export type GuardBlockingMode = "DISABLED" | "SOFT" | "HARD";

export const OPERATION_TYPES = [
  "LLM_REQUEST",
  "EMBEDDINGS",
  "ASR_TRANSCRIPTION",
  "STORAGE_UPLOAD",
  "CREATE_SKILL",
  "CREATE_KNOWLEDGE_BASE",
  "INVITE_MEMBER",
  "CREATE_ACTION",
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export type ExpectedCost =
  | { kind: "tokens"; value: number }
  | { kind: "bytes"; value: number }
  | { kind: "seconds"; value: number }
  | { kind: "objects"; value: number }
  | { kind: "custom"; value: number; label: string };

export type OperationContext = {
  workspaceId: string;
  operationType: OperationType;
  expectedCost?: ExpectedCost | null;
  meta?: Record<string, unknown>;
};

export type GuardDecision = {
  allowed: boolean;
  reasonCode: string;
  resourceType: string | null;
  message: string;
  upgradeAvailable: boolean;
  debug?: Record<string, unknown> | null;
};

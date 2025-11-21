export type LlmExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "timeout"
  | "cancelled";

export interface LlmExecutionSummary {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  skillId: string;
  skillName: string | null;
  skillIsSystem: boolean;
  chatId: string | null;
  status: LlmExecutionStatus;
  hasError: boolean;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userMessageId: string | null;
  userMessagePreview: string | null;
  metadata?: unknown;
}

export interface LlmExecutionStep {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  diagnosticInfo?: string | null;
  input: unknown;
  output: unknown;
}

export interface LlmExecutionListResponse {
  items: LlmExecutionSummary[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LlmExecutionDetail {
  execution: LlmExecutionSummary & { metadata?: unknown };
  steps: LlmExecutionStep[];
}

export interface LlmExecutionListParams {
  from?: string | Date;
  to?: string | Date;
  workspaceId?: string;
  skillId?: string;
  userId?: string;
  status?: LlmExecutionStatus;
  hasError?: boolean;
  page?: number;
  pageSize?: number;
}

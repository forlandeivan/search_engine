export type AsrExecutionStatus = "pending" | "processing" | "success" | "failed";

export type AsrExecutionStage =
  | "file_uploaded"
  | "audio_message_created"
  | "transcript_placeholder_message_created"
  | "asr_request_sent"
  | "asr_result_partial"
  | "asr_result_final"
  | "transcript_saved"
  | "auto_action_triggered"
  | "auto_action_completed"
  | "transcript_preview_message_created"
  | string;

export interface AsrExecutionEvent {
  id: string;
  timestamp: string;
  stage: AsrExecutionStage;
  details?: unknown;
}

export interface AsrExecutionSummary {
  id: string;
  workspaceId: string | null;
  workspaceName: string | null;
  skillId: string | null;
  skillName: string | null;
  chatId: string | null;
  userMessageId: string | null;
  transcriptMessageId: string | null;
  transcriptId: string | null;
  provider: string | null;
  status: AsrExecutionStatus;
  language: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  creditsChargedCents: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AsrExecutionDetail {
  execution: AsrExecutionSummary & { pipelineEvents?: AsrExecutionEvent[] };
}

export interface AsrExecutionListResponse {
  items: AsrExecutionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AsrExecutionListParams {
  from?: string | Date;
  to?: string | Date;
  status?: AsrExecutionStatus;
  provider?: string;
  workspaceId?: string;
  chatId?: string;
  skillId?: string;
  page?: number;
  pageSize?: number;
}

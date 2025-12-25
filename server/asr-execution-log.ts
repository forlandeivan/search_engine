import type { JsonValue } from "./json-types";

/**
 * ASR (speech-to-text) execution logging model.
 * Делается по аналогии с SkillExecution (LLM) журналом.
 */
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
  | "transcript_preview_message_created";

export interface AsrExecutionEvent {
  id: string;
  timestamp: string;
  stage: AsrExecutionStage | string;
  details?: JsonValue;
  [key: string]: JsonValue | undefined;
}

export interface AsrExecutionRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  workspaceId: string | null;
  skillId: string | null;
  chatId: string | null;
  userMessageId: string | null;
  transcriptMessageId: string | null;
  transcriptId: string | null;
  provider: string | null;
  mode: string | null;
  status: AsrExecutionStatus;
  language: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  durationMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  pipelineEvents: AsrExecutionEvent[];
}

export interface AsrExecutionCreateInput {
  workspaceId?: string | null;
  skillId?: string | null;
  chatId?: string | null;
  userMessageId?: string | null;
  transcriptMessageId?: string | null;
  transcriptId?: string | null;
  provider?: string | null;
  mode?: string | null;
  status?: AsrExecutionStatus;
  language?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  durationMs?: number | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  pipelineEvents?: AsrExecutionEvent[];
}

export interface AsrExecutionUpdateInput extends Partial<AsrExecutionCreateInput> {
  status?: AsrExecutionStatus;
  updatedAt?: Date;
}

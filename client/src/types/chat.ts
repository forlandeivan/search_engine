export type ChatSummary = {
  id: string;
  workspaceId: string;
  userId: string;
  skillId: string;
  status?: "active" | "archived";
  skillName?: string | null;
  skillStatus?: "active" | "archived" | null;
  currentAssistantAction?: AssistantActionState | null;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantActionState = {
  type: AssistantActionType;
  text: string | null;
  triggerMessageId: string | null;
  updatedAt: string | null;
};

export type ChatPayload = {
  workspaceId: string;
  skillId?: string;
  title?: string;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  type?: "text" | "file" | string;
  cardId?: string | null;
  content: string;
  createdAt: string;
  metadata?: {
    type?: "transcript" | string;
    transcriptId?: string;
    transcriptStatus?: "processing" | "postprocessing" | "ready" | "failed" | "auto_action_failed";
    previewText?: string;
    defaultViewId?: string | null;
    defaultViewActionId?: string | null;
    preferredTranscriptTabId?: string | null;
    streaming?: boolean;
    streamId?: string | null;
    triggerMessageId?: string | null;
    processedChunkIds?: string[];
    [key: string]: unknown;
  };
  file?: {
    attachmentId?: string | null;
    filename?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    uploadedByUserId?: string | null;
    downloadUrl?: string;
    expiresAt?: string | null;
  };
};

export type TranscriptView = {
  id: string;
  transcriptId: string;
  actionId?: string | null;
  label: string;
  content: string;
  createdAt: string;
};

export type Transcript = {
  id: string;
  workspaceId: string;
  chatId: string;
  sourceFileId: string | null;
  status: "processing" | "ready" | "failed";
  title: string | null;
  previewText: string | null;
  fullText: string | null;
  defaultViewId?: string | null;
  defaultViewActionId?: string | null;
  views?: TranscriptView[];
  lastEditedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CanvasDocumentType = "source" | "derived" | "summary" | "cleaned" | "custom";

export type CanvasDocument = {
  id: string;
  workspaceId: string;
  chatId: string;
  transcriptId?: string | null;
  skillId?: string | null;
  actionId?: string | null;
  type: CanvasDocumentType;
  title: string;
  content: string;
  isDefault: boolean;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
import type { AssistantActionType } from "@shared/schema";

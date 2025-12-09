export type ChatSummary = {
  id: string;
  workspaceId: string;
  userId: string;
  skillId: string;
  status?: "active" | "archived";
  skillName?: string | null;
  skillStatus?: "active" | "archived" | null;
  title: string;
  createdAt: string;
  updatedAt: string;
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
    [key: string]: unknown;
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

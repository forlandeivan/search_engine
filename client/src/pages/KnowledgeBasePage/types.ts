/**
 * Types for KnowledgeBasePage components
 */

import type { CreateKnowledgeDocumentFormValues } from "@/components/knowledge-base/CreateKnowledgeDocumentDialog";
import type { DocumentVectorizationProgressStatus } from "@/components/knowledge-base/DocumentVectorizationProgress";
import type { KnowledgeDocumentVectorizationSelection } from "@/components/knowledge-base/VectorizeKnowledgeDocumentDialog";
import type { VectorCollectionSummary } from "@/components/knowledge-base/KnowledgeBaseSearchSettingsForm";

// Constants
export const ROOT_PARENT_VALUE = "__root__";

// Knowledge Base Index Status
export type KnowledgeBaseIndexStatus = 
  | "not_indexed"
  | "indexing"
  | "up_to_date"
  | "outdated"
  | "error"
  | "partial";

// Knowledge Document Index Status  
export type KnowledgeDocumentIndexStatus =
  | "not_indexed"
  | "up_to_date"
  | "outdated"
  | "indexing"
  | "error";

// Page params
export type KnowledgeBasePageParams = {
  knowledgeBaseId?: string;
  nodeId?: string;
};

export type KnowledgeBasePageProps = {
  params?: KnowledgeBasePageParams;
};

// Folder tree
export type FolderOption = {
  id: string;
  title: string;
  level: number;
  type: "folder" | "document";
};

// Mutation variables
export type MoveNodeVariables = {
  baseId: string;
  nodeId: string;
  parentId: string | null;
};

export type DeleteNodeVariables = {
  baseId: string;
  nodeId: string;
};

export type CreateDocumentVariables = CreateKnowledgeDocumentFormValues & {
  baseId: string;
};

// Vectorization progress
export type DocumentVectorizationProgressState = {
  documentId: string;
  documentTitle: string;
  jobId: string | null;
  totalChunks: number;
  processedChunks: number;
  status: DocumentVectorizationProgressStatus;
  errorMessage: string | null;
  selection?: KnowledgeDocumentVectorizationSelection | null;
};

export type VectorCollectionsResponse = {
  collections: VectorCollectionSummary[];
};

// Quick search trigger props
export type QuickSearchTriggerProps = {
  query: string;
  placeholder: string;
  isOpen: boolean;
  onOpen: () => void;
  onOpenStateChange: (open: boolean) => void;
};

// Badge variants
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

// Status labels
export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "Архив",
};

export const DOCUMENT_SOURCE_LABELS: Record<string, string> = {
  manual: "Создан вручную",
  imported: "Импортирован",
  crawled: "Собран краулером",
};

export const INDEXING_STATUS_LABELS: Record<KnowledgeBaseIndexStatus, string> = {
  not_indexed: "Не индексирован",
  indexing: "Индексируется",
  up_to_date: "Актуален",
  outdated: "Устарел",
  error: "Ошибка",
  partial: "Частично",
};

export const INDEXING_STATUS_DESCRIPTIONS: Record<KnowledgeBaseIndexStatus, string> = {
  not_indexed: "База знаний ещё не индексирована",
  indexing: "Идёт индексация базы знаний",
  up_to_date: "Все документы проиндексированы",
  outdated: "Есть документы, требующие переиндексации",
  error: "Ошибка при индексации",
  partial: "Часть документов проиндексирована",
};

export const INDEXING_STATUS_BADGE_VARIANTS: Record<KnowledgeBaseIndexStatus, BadgeVariant> = {
  not_indexed: "secondary",
  indexing: "outline",
  up_to_date: "success",
  outdated: "warning",
  error: "destructive",
  partial: "warning",
};

export const INDEXING_CHANGE_STATUS_LABELS: Record<KnowledgeDocumentIndexStatus, string> = {
  not_indexed: "Не индексирован",
  up_to_date: "Актуален",
  outdated: "Устарел",
  indexing: "Индексируется",
  error: "Ошибка",
};

export const INDEXING_CHANGE_BADGE_VARIANTS: Record<KnowledgeDocumentIndexStatus, BadgeVariant> = {
  not_indexed: "secondary",
  up_to_date: "success",
  outdated: "warning",
  indexing: "outline",
  error: "destructive",
};

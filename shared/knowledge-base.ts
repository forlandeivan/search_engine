import type { KnowledgeNodeSourceType, KnowledgeDocumentStatus } from "./schema";

export type KnowledgeBaseNodeType = "folder" | "document";

export type KnowledgeDocumentChunkConfig = {
  maxTokens?: number | null;
  maxChars?: number | null;
  overlapTokens?: number | null;
  overlapChars?: number | null;
  splitByPages: boolean;
  respectHeadings: boolean;
};

export type KnowledgeDocumentChunkItem = {
  id: string;
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  pageNumber?: number | null;
  sectionPath?: string[];
  contentHash: string;
  metadata: Record<string, unknown>;
  vectorRecordId?: string | null;
};

export type KnowledgeDocumentChunkSet = {
  id: string;
  documentId: string;
  versionId: string;
  documentHash?: string | null;
  chunkCount: number;
  totalTokens: number;
  totalChars: number;
  createdAt: string;
  updatedAt: string;
  config: KnowledgeDocumentChunkConfig;
  chunks: KnowledgeDocumentChunkItem[];
};

export type KnowledgeDocumentChunkPreview = {
  documentId: string;
  versionId: string;
  versionNumber?: number | null;
  documentHash?: string | null;
  generatedAt: string;
  totalChunks: number;
  totalTokens: number;
  totalChars: number;
  config: KnowledgeDocumentChunkConfig;
  items: KnowledgeDocumentChunkItem[];
};

export type KnowledgeBaseTreeNode = {
  id: string;
  title: string;
  type: KnowledgeBaseNodeType;
  children?: KnowledgeBaseTreeNode[];
};

export type KnowledgeBaseSummary = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  rootNodes: KnowledgeBaseTreeNode[];
};

export type CreateKnowledgeBasePayload = {
  id?: string;
  name: string;
  description?: string;
};

export type CreateKnowledgeBaseResponse = KnowledgeBaseSummary;

export type CreateKnowledgeFolderPayload = {
  title: string;
  parentId?: string | null;
};

export type CreateKnowledgeDocumentPayload = {
  title: string;
  content?: string;
  parentId?: string | null;
  sourceType?: KnowledgeNodeSourceType;
  importFileName?: string | null;
};

export type UpdateKnowledgeDocumentPayload = {
  title: string;
  content?: string;
};

type KnowledgeNodeCreationBase = {
  id: string;
  title: string;
  parentId: string | null;
  updatedAt: string;
};

export type CreateKnowledgeFolderResponse = KnowledgeNodeCreationBase & {
  type: "folder";
};

export type CreateKnowledgeDocumentResponse = KnowledgeNodeCreationBase & {
  type: "document";
  content: string;
  sourceType: KnowledgeNodeSourceType;
  importFileName: string | null;
  documentId: string;
  status: KnowledgeDocumentStatus;
  versionId: string | null;
  versionNumber: number | null;
  children: KnowledgeBaseChildNode[];
  structure: KnowledgeBaseTreeNode[];
};

export type KnowledgeBaseBreadcrumb = {
  id: string;
  title: string;
  type: "base" | "folder";
};

export type KnowledgeBaseChildNode = {
  id: string;
  title: string;
  type: KnowledgeBaseNodeType;
  parentId: string | null;
  childCount: number;
  updatedAt: string;
  sourceType?: KnowledgeNodeSourceType;
  importFileName?: string | null;
};

export type KnowledgeBaseOverview = {
  type: "base";
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  rootNodes: KnowledgeBaseTreeNode[];
};

export type KnowledgeBaseFolderDetail = {
  type: "folder";
  id: string;
  title: string;
  updatedAt: string;
  breadcrumbs: KnowledgeBaseBreadcrumb[];
  children: KnowledgeBaseChildNode[];
  structure: KnowledgeBaseTreeNode[];
};

export type KnowledgeBaseDocumentDetail = {
  type: "document";
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  breadcrumbs: KnowledgeBaseBreadcrumb[];
  sourceType: KnowledgeNodeSourceType;
  importFileName: string | null;
  documentId: string;
  status: KnowledgeDocumentStatus;
  versionId: string | null;
  versionNumber: number | null;
  children: KnowledgeBaseChildNode[];
  structure: KnowledgeBaseTreeNode[];
  chunkSet?: KnowledgeDocumentChunkSet | null;
};

export type UpdateKnowledgeDocumentResponse = KnowledgeBaseDocumentDetail;

export type KnowledgeBaseNodeDetail =
  | KnowledgeBaseOverview
  | KnowledgeBaseFolderDetail
  | KnowledgeBaseDocumentDetail;

export type UpdateKnowledgeNodeParentRequest = {
  parentId: string | null;
};

export type DeleteKnowledgeNodeResponse = {
  deletedIds: string[];
};

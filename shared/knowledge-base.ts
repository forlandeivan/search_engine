import type { KnowledgeNodeSourceType, KnowledgeDocumentStatus } from "./schema";

export type KnowledgeBaseNodeType = "folder" | "document";

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
};

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

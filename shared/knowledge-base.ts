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

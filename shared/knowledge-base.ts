import type {
  KnowledgeNodeSourceType,
  KnowledgeDocumentStatus,
  KnowledgeBaseAskAiPipelineStepLog,
  KnowledgeBaseIndexStatus,
  KnowledgeDocumentIndexStatus,
} from "./schema";

export type KnowledgeBaseCrawlSelectorConfig = {
  title?: string | null;
  content?: string | null;
};

export type KnowledgeBaseCrawlAuthHeaders = Record<string, string>;

export type KnowledgeBaseCrawlAuthConfig = {
  headers?: KnowledgeBaseCrawlAuthHeaders;
};

export type KnowledgeBaseCrawlConfig = {
  startUrls: string[];
  sitemapUrl?: string | null;
  allowedDomains?: string[];
  include?: string[];
  exclude?: string[];
  maxPages?: number | null;
  maxDepth?: number | null;
  rateLimitRps?: number | null;
  robotsTxt?: boolean;
  userAgent?: string | null;
  selectors?: KnowledgeBaseCrawlSelectorConfig | null;
  language?: string | null;
  version?: string | null;
  auth?: KnowledgeBaseCrawlAuthConfig | null;
};

export type KnowledgeBaseCrawlJobPhase =
  | "created"
  | "crawling"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "paused"
  | "canceled"
  | "done"
  | "failed";

export type KnowledgeBaseCrawlJobStatus = {
  jobId: string;
  baseId: string;
  workspaceId: string;
  phase: KnowledgeBaseCrawlJobPhase;
  percent: number;
  discovered: number;
  queued: number;
  fetched: number;
  extracted: number;
  saved: number;
  failed: number;
  etaSec?: number | null;
  lastUrl?: string | null;
  lastError?: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  pagesTotal?: number | null;
  pagesNew?: number | null;
  pagesUpdated?: number | null;
  pagesSkipped?: number | null;
  errorsCount?: number | null;
  durationSec?: number | null;
  status: "running" | "paused" | "canceled" | "failed" | "done";
};

export type KnowledgeBaseCrawlJobEvent = KnowledgeBaseCrawlJobStatus;

export type KnowledgeBaseCrawlJobResponse = {
  kbId: string;
  jobId: string;
};

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
  maxChunkTokens?: number | null;
  maxChunkIndex?: number | null;
  maxChunkId?: string | null;
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
  maxChunkTokens?: number | null;
  maxChunkIndex?: number | null;
  maxChunkId?: string | null;
  config: KnowledgeDocumentChunkConfig;
  items: KnowledgeDocumentChunkItem[];
};

export type KnowledgeDocumentVectorizationJobResult = {
  message?: string | null;
  pointsCount: number;
  collectionName: string;
  vectorSize?: number | null;
  totalUsageTokens?: number | null;
  collectionCreated?: boolean;
  recordIds: string[];
  chunkSize: number;
  chunkOverlap: number;
  documentId?: string | null;
  provider?: {
    id?: string;
    name?: string;
  } | null;
};

export type KnowledgeDocumentVectorizationJobStatus = {
  id: string;
  documentId: string;
  status: "pending" | "running" | "completed" | "failed";
  totalChunks: number;
  processedChunks: number;
  startedAt: string;
  finishedAt: string | null;
  error?: string | null;
  result?: KnowledgeDocumentVectorizationJobResult | null;
};

export type KnowledgeBaseRagConfigWeights = {
  weight?: number | null;
  limit?: number | null;
};

export type KnowledgeBaseRagVectorConfig = KnowledgeBaseRagConfigWeights & {
  embeddingProviderId?: string | null;
  collection?: string | null;
};

export type KnowledgeBaseRagConfig = {
  workspaceId: string;
  knowledgeBaseId: string;
  topK?: number | null;
  bm25?: KnowledgeBaseRagConfigWeights | null;
  vector?: KnowledgeBaseRagVectorConfig | null;
  recordedAt?: string | null;
};

export type KnowledgeBaseRagConfigResponse = {
  config: KnowledgeBaseRagConfig;
};

export type KnowledgeBaseTreeNode = {
  id: string;
  title: string;
  type: KnowledgeBaseNodeType;
  sourceType?: KnowledgeNodeSourceType;
  children?: KnowledgeBaseTreeNode[];
};

export type KnowledgeBaseSummary = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  rootNodes: KnowledgeBaseTreeNode[];
};

export type KnowledgeBaseIndexingSummary = {
  baseId: string;
  status: KnowledgeBaseIndexStatus;
  totalDocuments: number;
  outdatedDocuments: number;
  indexingDocuments: number;
  errorDocuments: number;
  upToDateDocuments: number;
  policyHash: string | null;
  updatedAt: string;
};

export type KnowledgeBaseIndexingChangeItem = {
  documentId: string;
  nodeId: string;
  title: string;
  status: KnowledgeDocumentIndexStatus;
  updatedAt: string;
};

export type KnowledgeBaseIndexingChangesResponse = {
  items: KnowledgeBaseIndexingChangeItem[];
  total: number;
};

export type KnowledgeBaseAskAiRunSummary = {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  prompt: string;
  normalizedQuery?: string | null;
  status: "success" | "error";
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  topK?: number | null;
  bm25Weight?: number | null;
  bm25Limit?: number | null;
  vectorWeight?: number | null;
  vectorLimit?: number | null;
  vectorCollection?: string | null;
  embeddingProviderId?: string | null;
  llmProviderId?: string | null;
  llmModel?: string | null;
  bm25ResultCount?: number | null;
  vectorResultCount?: number | null;
  vectorDocumentCount?: number | null;
  combinedResultCount?: number | null;
  embeddingTokens?: number | null;
  llmTokens?: number | null;
  totalTokens?: number | null;
  retrievalDurationMs?: number | null;
  bm25DurationMs?: number | null;
  vectorDurationMs?: number | null;
  llmDurationMs?: number | null;
  totalDurationMs?: number | null;
};

export type KnowledgeBaseAskAiRunDetail = KnowledgeBaseAskAiRunSummary & {
  pipelineLog: KnowledgeBaseAskAiPipelineStepLog[];
};

export type KnowledgeBaseAskAiRunListResponse = {
  items: KnowledgeBaseAskAiRunSummary[];
  hasMore: boolean;
  nextOffset: number | null;
};

export type CreateKnowledgeBasePayload = {
  id?: string;
  name: string;
  description?: string;
};

export type CreateKnowledgeBaseResponse = KnowledgeBaseSummary;

export type DeleteKnowledgeBasePayload = {
  confirmation: string;
};

export type DeleteKnowledgeBaseResponse = {
  deletedId: string;
};

export type CreateKnowledgeFolderPayload = {
  title: string;
  parentId?: string | null;
};

export type CreateKnowledgeDocumentPayload = {
  title: string;
  content?: string;
  contentMarkdown?: string | null;
  contentPlainText?: string | null;
  parentId?: string | null;
  sourceType?: KnowledgeNodeSourceType;
  importFileName?: string | null;
};

export type CreateCrawledKnowledgeDocumentPayload = {
  url: string;
  parentId?: string | null;
  selectors?: KnowledgeBaseCrawlSelectorConfig | null;
  language?: string | null;
  version?: string | null;
  auth?: KnowledgeBaseCrawlAuthConfig | null;
};

export type CreateCrawledKnowledgeDocumentResponse = {
  status: "created" | "updated" | "skipped";
  document: KnowledgeBaseDocumentDetail;
};

export type UpdateKnowledgeDocumentPayload = {
  title: string;
  content?: string;
  contentMarkdown?: string | null;
  contentPlainText?: string | null;
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
  contentMarkdown?: string | null;
  contentPlainText?: string | null;
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
  contentMarkdown?: string | null;
  contentPlainText?: string | null;
  sourceUrl?: string | null;
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

export type KnowledgeBaseSuggestSection = {
  chunkId: string;
  documentId: string;
  docTitle: string;
  sectionTitle: string | null;
  snippet: string;
  score: number;
  source: "sections" | "content";
  nodeId?: string | null;
  nodeSlug?: string | null;
};

export type KnowledgeBaseSuggestResponse = {
  query: string;
  knowledgeBaseId: string;
  normalizedQuery: string;
  sections: KnowledgeBaseSuggestSection[];
};

export type KnowledgeBaseRagChunk = {
  chunkId: string;
  docId: string;
  docTitle: string;
  sectionTitle: string | null;
  snippet: string;
  text?: string;
  score: number;
  scores?: { bm25?: number | null; vector?: number | null };
  nodeId?: string | null;
  nodeSlug?: string | null;
};

export type KnowledgeBaseRagAnswer = {
  answer: string;
  format?: "text" | "markdown" | "html";
  query?: string;
  kbId?: string;
  normalizedQuery?: string;
  citations: KnowledgeBaseRagChunk[];
  chunks?: KnowledgeBaseRagChunk[];
  usage?: { embeddingTokens?: number | null; llmTokens?: number | null };
  timings?: {
    total_ms?: number;
    retrieval_ms?: number;
    bm25_ms?: number;
    vector_ms?: number;
    llm_ms?: number;
  };
};

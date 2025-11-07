import { isAfter } from "date-fns";
import type {
  KnowledgeBaseSummary,
  KnowledgeBaseTreeNode,
  KnowledgeDocumentChunkConfig,
  KnowledgeDocumentChunkItem,
  KnowledgeDocumentChunkSet,
  KnowledgeBaseCrawlJobStatus,
  KnowledgeBaseCrawlJobPhase,
} from "@shared/knowledge-base";

export type TreeNode = {
  id: string;
  title: string;
  type: "folder" | "document";
  children?: TreeNode[];
  documentId?: string;
};

export type KnowledgeDocumentVectorization = {
  collectionName: string;
  recordIds: string[];
  providerId: string;
  providerName?: string;
  vectorSize: number | null;
  chunkSize: number;
  chunkOverlap: number;
  pointsCount: number;
  totalUsageTokens?: number | null;
  vectorizedAt: string;
};

export type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  vectorization: KnowledgeDocumentVectorization | null;
  chunkSet?: KnowledgeDocumentChunkSet | null;
};

export type KnowledgeBaseSourceType = "blank" | "archive" | "crawler" | "unknown";

export type KnowledgeBaseTaskSummary = {
  total: number;
  inProgress: number;
  completed: number;
};

export type KnowledgeBaseIngestion = {
  type: KnowledgeBaseSourceType;
  archiveName?: string;
  seedUrl?: string;
  description?: string;
};

export type KnowledgeBaseImportErrorCode =
  | "invalid_path"
  | "unsupported_type"
  | "failed_conversion"
  | "empty_document"
  | "duplicate_path";

export type KnowledgeBaseImportError = {
  path: string;
  message: string;
  code: KnowledgeBaseImportErrorCode;
};

export type KnowledgeBaseImportSummary = {
  totalFiles: number;
  importedFiles: number;
  skippedFiles: number;
  errors: KnowledgeBaseImportError[];
  archiveName?: string;
  startedAt?: string;
  completedAt?: string;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  structure: TreeNode[];
  documents: Record<string, KnowledgeDocument>;
  sourceType?: KnowledgeBaseSourceType;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string | null;
  ingestion?: KnowledgeBaseIngestion;
  tasks?: KnowledgeBaseTaskSummary;
  importSummary?: KnowledgeBaseImportSummary;
  crawlJob?: KnowledgeBaseCrawlJobStatus;
};

export type SelectedDocumentState = {
  baseId: string;
  documentId: string;
};

export type KnowledgeBaseStorage = {
  knowledgeBases: KnowledgeBase[];
  selectedBaseId: string | null;
  selectedDocument: SelectedDocumentState | null;
};

const DEFAULT_TASKS: KnowledgeBaseTaskSummary = {
  total: 0,
  inProgress: 0,
  completed: 0,
};

export const KNOWLEDGE_BASE_STORAGE_KEY = "knowledge-base-state";
export const KNOWLEDGE_BASE_EVENT = "knowledge-base-storage-changed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSourceType = (value: unknown): value is KnowledgeBaseSourceType =>
  value === "blank" || value === "archive" || value === "crawler" || value === "unknown";

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
};

const parseDateIso = (value: unknown): string => {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return new Date().toISOString();
};

const parseOptionalDateIso = (value: unknown): string | null => {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return null;
};

const parseStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
};

const ensureMetadata = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

const CRAWL_JOB_PHASE_VALUES = [
  "created",
  "crawling",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
  "paused",
  "canceled",
  "done",
  "failed",
] as const;

const CRAWL_JOB_STATUS_VALUES = ["running", "paused", "canceled", "failed", "done"] as const;

const isCrawlJobPhase = (value: unknown): value is KnowledgeBaseCrawlJobPhase =>
  typeof value === "string" &&
  (CRAWL_JOB_PHASE_VALUES as ReadonlyArray<string>).includes(value.trim().toLowerCase());

const isCrawlJobStatus = (
  value: unknown,
): value is KnowledgeBaseCrawlJobStatus["status"] =>
  typeof value === "string" &&
  (CRAWL_JOB_STATUS_VALUES as ReadonlyArray<string>).includes(value.trim().toLowerCase());

const parseJobCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

const parseJobOptionalNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Number(value) : null;

const parseJobOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseCrawlPhase = (value: unknown): KnowledgeBaseCrawlJobPhase => {
  if (isCrawlJobPhase(value)) {
    return value.trim().toLowerCase() as KnowledgeBaseCrawlJobPhase;
  }

  return "created";
};

const parseCrawlStatus = (value: unknown): KnowledgeBaseCrawlJobStatus["status"] => {
  if (isCrawlJobStatus(value)) {
    return value.trim().toLowerCase() as KnowledgeBaseCrawlJobStatus["status"];
  }

  return "running";
};

const normalizeCrawlJob = (raw: unknown): KnowledgeBaseCrawlJobStatus | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const jobId = typeof raw.jobId === "string" ? raw.jobId : null;
  const baseId = typeof raw.baseId === "string" ? raw.baseId : null;
  const workspaceId = typeof raw.workspaceId === "string" ? raw.workspaceId : null;

  if (!jobId || !baseId || !workspaceId) {
    return null;
  }

  const startedAt = parseOptionalDateIso(raw.startedAt);
  const updatedAt = parseOptionalDateIso(raw.updatedAt) ?? startedAt ?? new Date().toISOString();

  const percentValue = parseJobOptionalNumber(raw.percent ?? raw.percentComplete ?? raw.percent_complete);

  return {
    jobId,
    baseId,
    workspaceId,
    phase: parseCrawlPhase(raw.phase),
    percent: Math.min(100, Math.max(0, percentValue ?? 0)),
    discovered: parseJobCount(raw.discovered),
    queued: parseJobCount(raw.queued),
    fetched: parseJobCount(raw.fetched),
    extracted: parseJobCount(raw.extracted),
    saved: parseJobCount(raw.saved),
    failed: parseJobCount(raw.failed),
    etaSec:
      parseJobOptionalNumber(raw.etaSec ?? raw.eta_sec ?? raw.eta) ??
      parseJobOptionalNumber(raw.etaSeconds ?? raw.eta_seconds),
    lastUrl: parseJobOptionalString(raw.lastUrl ?? raw.last_url),
    lastError: parseJobOptionalString(raw.lastError ?? raw.last_error),
    startedAt: startedAt ?? new Date().toISOString(),
    updatedAt,
    finishedAt: parseOptionalDateIso(raw.finishedAt ?? raw.finished_at),
    pagesTotal: parseJobOptionalNumber(raw.pagesTotal ?? raw.pages_total),
    pagesNew: parseJobOptionalNumber(raw.pagesNew ?? raw.pages_new),
    pagesUpdated: parseJobOptionalNumber(raw.pagesUpdated ?? raw.pages_updated),
    pagesSkipped: parseJobOptionalNumber(raw.pagesSkipped ?? raw.pages_skipped),
    errorsCount: parseJobOptionalNumber(raw.errorsCount ?? raw.errors_count),
    durationSec: parseJobOptionalNumber(raw.durationSec ?? raw.duration_sec),
    status: parseCrawlStatus(raw.status),
  } satisfies KnowledgeBaseCrawlJobStatus;
};

const countTokens = (text: string): number => {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
};

const fallbackChunkHash = (text: string, index: number): string => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `local-${index}-${Math.abs(hash)}`;
};

const normalizeChunkConfig = (raw: unknown): KnowledgeDocumentChunkConfig => {
  const record = ensureMetadata(raw);

  const maxTokens = parseNumber(record.maxTokens ?? record.max_tokens) ?? null;
  const maxChars = parseNumber(record.maxChars ?? record.max_chars) ?? null;
  const overlapTokens = parseNumber(record.overlapTokens ?? record.overlap_tokens) ?? null;
  const overlapChars = parseNumber(record.overlapChars ?? record.overlap_chars) ?? null;
  const splitByPagesRaw = record.splitByPages ?? record.split_by_pages;
  const respectHeadingsRaw = record.respectHeadings ?? record.respect_headings;

  return {
    maxTokens,
    maxChars,
    overlapTokens,
    overlapChars,
    splitByPages: typeof splitByPagesRaw === "boolean" ? splitByPagesRaw : false,
    respectHeadings: typeof respectHeadingsRaw === "boolean" ? respectHeadingsRaw : true,
  } satisfies KnowledgeDocumentChunkConfig;
};

const normalizeChunkItems = (raw: unknown): KnowledgeDocumentChunkItem[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const items: KnowledgeDocumentChunkItem[] = [];

  raw.forEach((entry, arrayIndex) => {
    if (typeof entry !== "object" || entry === null) {
      return;
    }

    const record = entry as Record<string, unknown>;
    const textRaw =
      typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
        ? record.content
        : "";

    const text = textRaw.replace(/\s+/gu, " ").trim();
    if (!text) {
      return;
    }

    const indexValue = parseNumber(record.index) ?? arrayIndex;
    const charStart = parseNumber(record.charStart ?? record.start) ?? 0;
    const charEnd = parseNumber(record.charEnd ?? record.end) ?? charStart + text.length;
    const tokenCount = parseNumber(record.tokenCount) ?? countTokens(text);
    const pageNumber = parseNumber(record.pageNumber ?? record.page) ?? null;
    const sectionPath = parseStringArray(record.sectionPath ?? record.headingPath ?? record.hierarchy);
    const baseMetadata = ensureMetadata(record.metadata);
    const metadata: Record<string, unknown> = { ...baseMetadata };
    if (sectionPath && !("sectionPath" in metadata)) {
      metadata.sectionPath = sectionPath;
    }

    const contentHashRaw =
      typeof record.contentHash === "string" && record.contentHash.trim().length > 0
        ? record.contentHash.trim()
        : null;

    const vectorRecordIdRaw = record.vectorRecordId ?? record.vectorId ?? null;
    const vectorRecordId =
      typeof vectorRecordIdRaw === "string"
        ? vectorRecordIdRaw.trim().length > 0
          ? vectorRecordIdRaw.trim()
          : null
        : typeof vectorRecordIdRaw === "number" && Number.isFinite(vectorRecordIdRaw)
        ? String(vectorRecordIdRaw)
        : null;

    const idValue =
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim()
        : `chunk-${indexValue + 1}`;

    items.push({
      id: idValue,
      index: indexValue,
      text,
      charStart,
      charEnd,
      tokenCount,
      pageNumber,
      sectionPath,
      metadata,
      contentHash: contentHashRaw ?? fallbackChunkHash(text, indexValue),
      vectorRecordId,
    });
  });

  items.sort((a, b) => a.index - b.index);

  return items;
};

const normalizeDocumentChunkSet = (raw: unknown): KnowledgeDocumentChunkSet | null => {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const documentId =
    typeof record.documentId === "string"
      ? record.documentId
      : typeof record.document_id === "string"
      ? record.document_id
      : undefined;
  const versionId =
    typeof record.versionId === "string"
      ? record.versionId
      : typeof record.version_id === "string"
      ? record.version_id
      : undefined;

  if (!documentId || !versionId) {
    return null;
  }

  const items = normalizeChunkItems(record.chunks ?? record.items);
  if (items.length === 0) {
    return null;
  }

  const id = typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `${documentId}-chunks`;
  const config = normalizeChunkConfig(record.config ?? record);
  const chunkCount = parseNumber(record.chunkCount) ?? items.length;
  const totalTokens = parseNumber(record.totalTokens) ?? items.reduce((sum, item) => sum + item.tokenCount, 0);
  const totalChars = parseNumber(record.totalChars) ?? items.reduce((sum, item) => sum + item.text.length, 0);
  const createdAt = parseDateIso(record.createdAt ?? record.generatedAt);
  const updatedAt = parseDateIso(record.updatedAt ?? record.generatedAt ?? record.createdAt);
  const documentHash =
    typeof record.documentHash === "string"
      ? record.documentHash
      : typeof record.document_hash === "string"
      ? record.document_hash
      : undefined;
  const maxChunkTokens = parseNumber(record.maxChunkTokens ?? record.max_chunk_tokens);
  const maxChunkIndexRaw = parseNumber(record.maxChunkIndex ?? record.max_chunk_index);
  const rawMaxChunkId =
    typeof record.maxChunkId === "string" && record.maxChunkId.trim().length > 0
      ? record.maxChunkId.trim()
      : typeof record.max_chunk_id === "string" && record.max_chunk_id.trim().length > 0
      ? record.max_chunk_id.trim()
      : null;
  const maxChunkIndex =
    typeof maxChunkIndexRaw === "number" && Number.isFinite(maxChunkIndexRaw)
      ? Math.max(0, Math.floor(maxChunkIndexRaw))
      : null;

  return {
    id,
    documentId,
    versionId,
    documentHash,
    chunkCount,
    totalTokens,
    totalChars,
    maxChunkTokens: typeof maxChunkTokens === "number" && Number.isFinite(maxChunkTokens) ? maxChunkTokens : null,
    maxChunkIndex,
    maxChunkId: rawMaxChunkId,
    createdAt,
    updatedAt,
    config,
    chunks: items,
  } satisfies KnowledgeDocumentChunkSet;
};

export const KNOWLEDGE_BASE_SOURCE_LABELS: Record<KnowledgeBaseSourceType, string> = {
  blank: "Пустая база",
  archive: "Импорт из архива",
  crawler: "Краулинг сайта",
  unknown: "Неизвестный источник",
};

export const KNOWLEDGE_BASE_SOURCE_ICONS: Record<KnowledgeBaseSourceType, string> = {
  blank: "🗂️",
  archive: "🗜️",
  crawler: "🌐",
  unknown: "ℹ️",
};

export const createRandomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
};

const normalizeTreeNodes = (rawNodes: unknown): TreeNode[] => {
  if (!Array.isArray(rawNodes)) {
    return [];
  }

  return rawNodes
    .map((node) => {
      if (!isRecord(node)) {
        return null;
      }

      const type = node.type === "folder" || node.type === "document" ? node.type : "folder";

      const normalized: TreeNode = {
        id: typeof node.id === "string" ? node.id : createRandomId(),
        title: typeof node.title === "string" ? node.title : "Без названия",
        type,
      };

      if (type === "folder") {
        normalized.children = normalizeTreeNodes(node.children);
      } else if (typeof node.documentId === "string") {
        normalized.documentId = node.documentId;
      }

      return normalized;
    })
    .filter((node): node is TreeNode => Boolean(node));
};

const normalizeVectorization = (raw: unknown): KnowledgeDocumentVectorization | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const collectionName = typeof raw.collectionName === "string" ? raw.collectionName.trim() : "";
  const providerId = typeof raw.providerId === "string" ? raw.providerId.trim() : "";
  const rawChunkSize = raw.chunkSize;
  const chunkSize =
    typeof rawChunkSize === "number" && Number.isFinite(rawChunkSize) && rawChunkSize > 0
      ? Math.round(rawChunkSize)
      : null;
  const rawChunkOverlap = raw.chunkOverlap;
  const chunkOverlap =
    typeof rawChunkOverlap === "number" && Number.isFinite(rawChunkOverlap) && rawChunkOverlap >= 0
      ? Math.min(Math.round(rawChunkOverlap), chunkSize ?? Math.round(rawChunkOverlap))
      : 0;

  const recordIds = Array.isArray(raw.recordIds)
    ? raw.recordIds
        .map((value) => {
          if (typeof value === "number" || typeof value === "string") {
            const stringValue = String(value).trim();
            return stringValue.length > 0 ? stringValue : null;
          }
          return null;
        })
        .filter((value): value is string => Boolean(value))
    : [];

  if (!collectionName || !providerId || !chunkSize || recordIds.length === 0) {
    return null;
  }

  const rawVectorSize = raw.vectorSize;
  const vectorSize =
    typeof rawVectorSize === "number" && Number.isFinite(rawVectorSize) && rawVectorSize > 0
      ? Math.round(rawVectorSize)
      : null;

  const rawPointsCount = raw.pointsCount;
  const pointsCount =
    typeof rawPointsCount === "number" && Number.isFinite(rawPointsCount) && rawPointsCount >= 0
      ? Math.round(rawPointsCount)
      : recordIds.length;

  const rawTotalUsageTokens = raw.totalUsageTokens;
  const totalUsageTokens =
    typeof rawTotalUsageTokens === "number" && Number.isFinite(rawTotalUsageTokens) && rawTotalUsageTokens >= 0
      ? Math.round(rawTotalUsageTokens)
      : null;

  const providerName = typeof raw.providerName === "string" ? raw.providerName : undefined;

  const vectorizedAtRaw = raw.vectorizedAt;
  const vectorizedAt =
    typeof vectorizedAtRaw === "string" && !Number.isNaN(Date.parse(vectorizedAtRaw))
      ? vectorizedAtRaw
      : new Date().toISOString();

  return {
    collectionName,
    providerId,
    providerName,
    recordIds,
    vectorSize,
    chunkSize,
    chunkOverlap,
    pointsCount,
    totalUsageTokens,
    vectorizedAt,
  };
};

const normalizeDocuments = (rawDocuments: unknown): Record<string, KnowledgeDocument> => {
  if (!isRecord(rawDocuments)) {
    return {};
  }

  const result: Record<string, KnowledgeDocument> = {};

  Object.entries(rawDocuments).forEach(([key, value]) => {
    if (!isRecord(value)) {
      return;
    }

    const id = typeof value.id === "string" ? value.id : key;
    const title = typeof value.title === "string" ? value.title : "Без названия";
    const content = typeof value.content === "string" ? value.content : "";
    const updatedAt =
      typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt))
        ? value.updatedAt
        : new Date().toISOString();

    result[key] = {
      id,
      title,
      content,
      updatedAt,
      vectorization: normalizeVectorization(value.vectorization),
      chunkSet: normalizeDocumentChunkSet((value as Record<string, unknown>).chunkSet ?? value.chunks),
    };
  });

  return result;
};

const normalizeTasks = (rawTasks: unknown): KnowledgeBaseTaskSummary => {
  if (!isRecord(rawTasks)) {
    return { ...DEFAULT_TASKS };
  }

  const total = typeof rawTasks.total === "number" ? rawTasks.total : DEFAULT_TASKS.total;
  const inProgress = typeof rawTasks.inProgress === "number" ? rawTasks.inProgress : DEFAULT_TASKS.inProgress;
  const completed = typeof rawTasks.completed === "number" ? rawTasks.completed : DEFAULT_TASKS.completed;

  return { total, inProgress, completed };
};

const normalizeIngestion = (rawIngestion: unknown): KnowledgeBaseIngestion | undefined => {
  if (!isRecord(rawIngestion)) {
    return undefined;
  }

  const type = isSourceType(rawIngestion.type) ? rawIngestion.type : undefined;
  if (!type) {
    return undefined;
  }

  const archiveName = typeof rawIngestion.archiveName === "string" ? rawIngestion.archiveName : undefined;
  const seedUrl = typeof rawIngestion.seedUrl === "string" ? rawIngestion.seedUrl : undefined;
  const description = typeof rawIngestion.description === "string" ? rawIngestion.description : undefined;

  return { type, archiveName, seedUrl, description };
};

const normalizeImportError = (raw: unknown): KnowledgeBaseImportError | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const path = typeof raw.path === "string" ? raw.path : "";
  const message = typeof raw.message === "string" ? raw.message : "";
  const code =
    raw.code === "invalid_path" ||
    raw.code === "unsupported_type" ||
    raw.code === "failed_conversion" ||
    raw.code === "empty_document" ||
    raw.code === "duplicate_path"
      ? raw.code
      : "failed_conversion";

  if (!path || !message) {
    return null;
  }

  return { path, message, code };
};

const normalizeImportSummary = (raw: unknown): KnowledgeBaseImportSummary | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }

  const totalFiles = typeof raw.totalFiles === "number" ? raw.totalFiles : 0;
  const importedFiles = typeof raw.importedFiles === "number" ? raw.importedFiles : 0;
  const skippedFiles = typeof raw.skippedFiles === "number" ? raw.skippedFiles : 0;

  const rawErrors = Array.isArray(raw.errors) ? raw.errors : [];
  const errors = rawErrors
    .map((item) => normalizeImportError(item))
    .filter((error): error is KnowledgeBaseImportError => Boolean(error));

  const archiveName = typeof raw.archiveName === "string" ? raw.archiveName : undefined;
  const startedAt =
    typeof raw.startedAt === "string" && !Number.isNaN(Date.parse(raw.startedAt))
      ? raw.startedAt
      : undefined;
  const completedAt =
    typeof raw.completedAt === "string" && !Number.isNaN(Date.parse(raw.completedAt))
      ? raw.completedAt
      : undefined;

  return {
    totalFiles,
    importedFiles,
    skippedFiles,
    errors,
    archiveName,
    startedAt,
    completedAt,
  };
};

const normalizeKnowledgeBase = (raw: unknown): KnowledgeBase => {
  if (!isRecord(raw)) {
    return {
      id: createRandomId(),
      name: "Новая база знаний",
      description: "",
      structure: [],
      documents: {},
      sourceType: "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: null,
      tasks: { ...DEFAULT_TASKS },
      importSummary: undefined,
      crawlJob: undefined,
    };
  }

  const baseId = typeof raw.id === "string" ? raw.id : createRandomId();
  const createdAt =
    typeof raw.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : new Date().toISOString();
  const updatedAtCandidate =
    typeof raw.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : createdAt;

  const updatedAt = isAfter(new Date(updatedAtCandidate), new Date(createdAt))
    ? updatedAtCandidate
    : createdAt;

  const lastOpenedAt =
    typeof raw.lastOpenedAt === "string" && !Number.isNaN(Date.parse(raw.lastOpenedAt)) ? raw.lastOpenedAt : null;

  const sourceType: KnowledgeBaseSourceType = isSourceType(raw.sourceType) ? raw.sourceType : "unknown";

  const crawlJob = normalizeCrawlJob(raw.crawlJob);

  return {
    id: baseId,
    name: typeof raw.name === "string" ? raw.name : "Без названия",
    description: typeof raw.description === "string" ? raw.description : "",
    structure: normalizeTreeNodes(raw.structure),
    documents: normalizeDocuments(raw.documents),
    sourceType,
    createdAt,
    updatedAt,
    lastOpenedAt,
    ingestion: normalizeIngestion(raw.ingestion),
    tasks: normalizeTasks(raw.tasks),
    importSummary: normalizeImportSummary(raw.importSummary),
    crawlJob: crawlJob ?? undefined,
  };
};

const EMPTY_STORAGE: KnowledgeBaseStorage = {
  knowledgeBases: [],
  selectedBaseId: null,
  selectedDocument: null,
};

const normalizeSelectedDocument = (raw: unknown): SelectedDocumentState | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const baseId = typeof raw.baseId === "string" ? raw.baseId : null;
  const documentId = typeof raw.documentId === "string" ? raw.documentId : null;

  if (!baseId || !documentId) {
    return null;
  }

  return { baseId, documentId };
};

export const readKnowledgeBaseStorage = (): KnowledgeBaseStorage => {
  if (typeof window === "undefined") {
    return EMPTY_STORAGE;
  }

  try {
    const raw = window.localStorage.getItem(KNOWLEDGE_BASE_STORAGE_KEY);
    if (!raw) {
      return EMPTY_STORAGE;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const knowledgeBases = Array.isArray(parsed.knowledgeBases)
      ? parsed.knowledgeBases.map((base) => normalizeKnowledgeBase(base))
      : [];

    const selectedBaseId = typeof parsed.selectedBaseId === "string" ? parsed.selectedBaseId : null;
    const selectedDocument = normalizeSelectedDocument(parsed.selectedDocument);

    return {
      knowledgeBases,
      selectedBaseId,
      selectedDocument,
    };
  } catch (error) {
    console.error("Не удалось прочитать базы знаний из localStorage", error);
    return EMPTY_STORAGE;
  }
};

export const writeKnowledgeBaseStorage = (state: KnowledgeBaseStorage) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(KNOWLEDGE_BASE_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new Event(KNOWLEDGE_BASE_EVENT));
  } catch (error) {
    console.error("Не удалось сохранить базы знаний в localStorage", error);
  }
};

export const KNOWLEDGE_BASE_STORAGE_CLEANUP_FLAG = "knowledge-base-storage-cleared-v1";

export const clearKnowledgeBaseStorage = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(KNOWLEDGE_BASE_STORAGE_KEY);
    window.dispatchEvent(new Event(KNOWLEDGE_BASE_EVENT));
  } catch (error) {
    console.error("Не удалось очистить базы знаний в localStorage", error);
  }
};

export const clearLegacyKnowledgeBaseStorageOnce = () => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (window.localStorage.getItem(KNOWLEDGE_BASE_STORAGE_CLEANUP_FLAG)) {
      return false;
    }

    clearKnowledgeBaseStorage();
    window.localStorage.setItem(KNOWLEDGE_BASE_STORAGE_CLEANUP_FLAG, "1");
    return true;
  } catch (error) {
    console.error("Не удалось выполнить миграцию баз знаний", error);
    return false;
  }
};

const mapSummaryTreeNodes = (nodes: KnowledgeBaseTreeNode[]): TreeNode[] =>
  nodes.map((node) => ({
    id: node.id,
    title: node.title,
    type: node.type === "folder" ? "folder" : "document",
    children: node.children ? mapSummaryTreeNodes(node.children) : undefined,
  }));

const mergeKnowledgeBaseSummary = (
  summary: KnowledgeBaseSummary,
  previous?: KnowledgeBase,
): KnowledgeBase => ({
  id: summary.id,
  name: summary.name,
  description: summary.description,
  structure: mapSummaryTreeNodes(summary.rootNodes ?? []),
  documents: previous?.documents ? { ...previous.documents } : {},
  sourceType: previous?.sourceType ?? "unknown",
  createdAt: previous?.createdAt ?? summary.updatedAt,
  updatedAt: summary.updatedAt,
  lastOpenedAt: previous?.lastOpenedAt ?? null,
  ingestion: previous?.ingestion,
  tasks: previous?.tasks ? { ...previous.tasks } : { ...DEFAULT_TASKS },
  importSummary: previous?.importSummary,
  crawlJob: previous?.crawlJob ? { ...previous.crawlJob } : undefined,
});

export const syncKnowledgeBaseStorageFromSummaries = (
  summaries: KnowledgeBaseSummary[],
): KnowledgeBaseStorage => {
  const currentState = readKnowledgeBaseStorage();
  const previousById = new Map(currentState.knowledgeBases.map((base) => [base.id, base]));

  const knowledgeBases = summaries.map((summary) =>
    mergeKnowledgeBaseSummary(summary, previousById.get(summary.id)),
  );

  const selectedBaseId =
    currentState.selectedBaseId &&
    knowledgeBases.some((base) => base.id === currentState.selectedBaseId)
      ? currentState.selectedBaseId
      : knowledgeBases[0]?.id ?? null;

  const selectedDocument =
    currentState.selectedDocument &&
    knowledgeBases.some((base) => base.id === currentState.selectedDocument?.baseId)
      ? currentState.selectedDocument
      : null;

  const updatedState: KnowledgeBaseStorage = {
    knowledgeBases,
    selectedBaseId,
    selectedDocument,
  };

  writeKnowledgeBaseStorage(updatedState);
  return updatedState;
};

export const updateKnowledgeBaseCrawlJob = (
  baseId: string,
  job: KnowledgeBaseCrawlJobStatus | null,
) => {
  const currentState = readKnowledgeBaseStorage();
  let changed = false;

  const knowledgeBases = currentState.knowledgeBases.map((base) => {
    if (base.id !== baseId) {
      return base;
    }

    if (job) {
      const previous = base.crawlJob;
      const isSame =
        previous !== undefined &&
        previous.jobId === job.jobId &&
        previous.updatedAt === job.updatedAt &&
        previous.status === job.status &&
        previous.percent === job.percent &&
        previous.saved === job.saved &&
        previous.failed === job.failed &&
        previous.fetched === job.fetched &&
        previous.discovered === job.discovered &&
        previous.queued === job.queued;

      if (isSame) {
        return base;
      }

      changed = true;
      return { ...base, crawlJob: { ...job } };
    }

    if (base.crawlJob !== undefined) {
      changed = true;
      return { ...base, crawlJob: undefined };
    }

    return base;
  });

  if (!changed) {
    return currentState;
  }

  const nextState: KnowledgeBaseStorage = {
    ...currentState,
    knowledgeBases,
  };

  writeKnowledgeBaseStorage(nextState);
  return nextState;
};

export const createKnowledgeBaseEntry = ({
  name,
  description,
  sourceType = "blank",
  ingestion,
  importSummary,
}: {
  name: string;
  description?: string;
  sourceType?: KnowledgeBaseSourceType;
  ingestion?: KnowledgeBaseIngestion;
  importSummary?: KnowledgeBaseImportSummary;
}): KnowledgeBase => {
  const timestamp = new Date().toISOString();

  return {
    id: createRandomId(),
    name: name.trim(),
    description: description?.trim() ?? "",
    structure: [],
    documents: {},
    sourceType,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    ingestion: ingestion ? { ...ingestion, type: ingestion.type } : undefined,
    tasks: { ...DEFAULT_TASKS },
    importSummary: importSummary ? { ...importSummary } : undefined,
  };
};

export const getKnowledgeBaseSourceLabel = (sourceType?: KnowledgeBaseSourceType) =>
  KNOWLEDGE_BASE_SOURCE_LABELS[sourceType ?? "unknown"];

export const touchKnowledgeBase = (base: KnowledgeBase, date: Date = new Date()): KnowledgeBase => ({
  ...base,
  lastOpenedAt: date.toISOString(),
  updatedAt: date.toISOString(),
});

export const updateKnowledgeBaseTimestamp = (base: KnowledgeBase, date: Date = new Date()): KnowledgeBase => ({
  ...base,
  updatedAt: date.toISOString(),
});

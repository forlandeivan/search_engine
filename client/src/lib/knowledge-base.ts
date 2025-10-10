import { isAfter } from "date-fns";

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

import JSZip from "jszip";

import {
  convertBufferToHtml,
  getSanitizedContent,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from "@/lib/document-import";
import {
  createRandomId,
  type TreeNode,
  type KnowledgeDocument,
  type KnowledgeBaseImportError,
  type KnowledgeBaseImportSummary,
  type KnowledgeBaseImportErrorCode,
} from "@/lib/knowledge-base";

type FolderNode = TreeNode & { children: TreeNode[] };

const INVALID_SEGMENT_PATTERN = /[\u0000]/;

const sanitizePathSegments = (rawPath: string): string[] | null => {
  const normalized = rawPath.replace(/\\+/g, "/").replace(/\/+$/g, "");
  if (!normalized || normalized.startsWith("/")) {
    return null;
  }

  if (/^[a-zA-Z]:/.test(normalized)) {
    return null;
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

  const safeSegments: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      return null;
    }

    if (INVALID_SEGMENT_PATTERN.test(segment)) {
      return null;
    }

    safeSegments.push(segment);
  }

  return safeSegments;
};

const ensureFolder = (
  segments: string[],
  tree: TreeNode[],
  folderMap: Map<string, FolderNode>,
): TreeNode[] => {
  if (segments.length === 0) {
    return tree;
  }

  let currentChildren = tree;
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = folderMap.get(currentPath);

    if (existing) {
      if (!existing.children) {
        existing.children = [];
      }
      currentChildren = existing.children;
      continue;
    }

    const folderNode: FolderNode = {
      id: createRandomId(),
      title: segment,
      type: "folder",
      children: [],
    };

    folderMap.set(currentPath, folderNode);
    currentChildren.push(folderNode);
    currentChildren = folderNode.children;
  }

  return currentChildren;
};

const buildError = (
  code: KnowledgeBaseImportErrorCode,
  path: string,
  message: string,
): KnowledgeBaseImportError => ({
  code,
  path,
  message,
});

export type ArchiveImportResult = {
  structure: TreeNode[];
  documents: Record<string, KnowledgeDocument>;
  errors: KnowledgeBaseImportError[];
  summary: KnowledgeBaseImportSummary;
};

export const importKnowledgeArchive = async (file: File): Promise<ArchiveImportResult> => {
  const startedAt = new Date().toISOString();
  const zip = await JSZip.loadAsync(file);
  const rootNodes: TreeNode[] = [];
  const folderMap = new Map<string, FolderNode>();
  const documents: Record<string, KnowledgeDocument> = {};
  const createdDocumentByPath = new Map<string, string>();
  const errors: KnowledgeBaseImportError[] = [];

  let totalFiles = 0;
  let importedFiles = 0;
  let skippedFiles = 0;

  const entries = Object.values(zip.files);

  for (const entry of entries) {
    const segments = sanitizePathSegments(entry.name);
    if (!segments) {
      errors.push(buildError("invalid_path", entry.name, "Неверный путь внутри архива"));
      skippedFiles += entry.dir ? 0 : 1;
      continue;
    }

    if (entry.dir) {
      ensureFolder(segments, rootNodes, folderMap);
      continue;
    }

    if (segments.length === 0) {
      continue;
    }

    totalFiles += 1;
    const normalizedPath = segments.join("/");
    if (createdDocumentByPath.has(normalizedPath)) {
      errors.push(buildError("duplicate_path", normalizedPath, "Файл уже обработан"));
      skippedFiles += 1;
      continue;
    }

    const fileName = segments[segments.length - 1];
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

    if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
      errors.push(buildError("unsupported_type", normalizedPath, "Формат файла не поддерживается"));
      skippedFiles += 1;
      continue;
    }

    try {
      const buffer = await entry.async("arraybuffer");
      const { title, html } = await convertBufferToHtml({ data: buffer, filename: fileName });
      const sanitizedContent = getSanitizedContent(html);

      if (!sanitizedContent.trim()) {
        errors.push(buildError("empty_document", normalizedPath, "Документ не содержит контента"));
        skippedFiles += 1;
        continue;
      }

      const documentId = createRandomId();
      documents[documentId] = {
        id: documentId,
        title,
        content: sanitizedContent,
        updatedAt: new Date().toISOString(),
        vectorization: null,
      } satisfies KnowledgeDocument;

      const folderSegments = segments.slice(0, -1);
      const parentChildren = ensureFolder(folderSegments, rootNodes, folderMap);
      const nodeId = createRandomId();

      parentChildren.push({
        id: nodeId,
        title,
        type: "document",
        documentId,
      });

      createdDocumentByPath.set(normalizedPath, documentId);
      importedFiles += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось обработать документ";
      errors.push(buildError("failed_conversion", normalizedPath, message));
      skippedFiles += 1;
    }
  }

  const completedAt = new Date().toISOString();

  const summary: KnowledgeBaseImportSummary = {
    totalFiles,
    importedFiles,
    skippedFiles,
    errors,
    archiveName: file.name,
    startedAt,
    completedAt,
  };

  return {
    structure: rootNodes,
    documents,
    errors,
    summary,
  };
};


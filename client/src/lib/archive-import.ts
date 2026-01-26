import JSZip from "jszip";
import { Archive } from "libarchive.js/main.js";
import workerBundleUrl from "libarchive.js/dist/worker-bundle.js?url";

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

// Инициализируем libarchive.js один раз
let archiveInitialized = false;
const initArchive = async () => {
  if (!archiveInitialized) {
    try {
      await Archive.init({
        workerUrl: workerBundleUrl,
      });
      archiveInitialized = true;
    } catch (error) {
      console.warn("Failed to initialize libarchive.js:", error);
      // Продолжаем работу, возможно worker уже загружен
    }
  }
};

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

/**
 * Определяет тип архива по расширению файла
 */
const getArchiveType = (fileName: string): "zip" | "rar" | "7z" | "unknown" => {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "zip") return "zip";
  if (extension === "rar") return "rar";
  if (extension === "7z") return "7z";
  return "unknown";
};

/**
 * Проверяет, является ли файл ZIP архивом по сигнатуре (magic bytes)
 */
const isZipFile = async (file: File): Promise<boolean> => {
  try {
    const buffer = await file.slice(0, 4).arrayBuffer();
    const view = new Uint8Array(buffer);
    // ZIP файлы начинаются с "PK" (0x50 0x4B)
    return view.length >= 2 && view[0] === 0x50 && view[1] === 0x4b;
  } catch {
    return false;
  }
};

/**
 * Собирает все файлы из объекта архива в плоский список
 */
const collectFilesFromArchive = (
  filesObj: Record<string, File | Record<string, unknown>>,
  basePath = "",
): Array<{ path: string; file: File }> => {
  const files: Array<{ path: string; file: File }> = [];

  for (const [key, value] of Object.entries(filesObj)) {
    const fullPath = basePath ? `${basePath}/${key}` : key;

    if (value instanceof File) {
      files.push({ path: fullPath, file: value });
    } else if (typeof value === "object" && value !== null) {
      // Рекурсивно обрабатываем вложенные папки
      files.push(...collectFilesFromArchive(value as Record<string, File | Record<string, unknown>>, fullPath));
    }
  }

  return files;
};

/**
 * Обрабатывает архив через libarchive.js (RAR, 7z и другие форматы)
 */
const processArchiveWithLibArchive = async (
  file: File,
  rootNodes: TreeNode[],
  folderMap: Map<string, FolderNode>,
  documents: Record<string, KnowledgeDocument>,
  createdDocumentByPath: Map<string, string>,
  errors: KnowledgeBaseImportError[],
): Promise<{ totalFiles: number; importedFiles: number; skippedFiles: number }> => {
  let totalFiles = 0;
  let importedFiles = 0;
  let skippedFiles = 0;

  try {
    // Инициализируем libarchive.js перед использованием
    await initArchive();
    
    const archive = await Archive.open(file);
    const filesObj = await archive.extractFiles();

    // Собираем все файлы в плоский список
    const allFiles = collectFilesFromArchive(filesObj as Record<string, File | Record<string, unknown>>);

    // Обрабатываем все файлы и собираем результаты
    const results = await Promise.all(
      allFiles.map(async ({ path, file: archiveFile }) => {
        const segments = sanitizePathSegments(path);
        if (!segments) {
          errors.push(buildError("invalid_path", path, "Неверный путь внутри архива"));
          return { imported: false, skipped: true };
        }

        if (segments.length === 0) {
          return { imported: false, skipped: false };
        }

        const normalizedPath = segments.join("/");
        if (createdDocumentByPath.has(normalizedPath)) {
          errors.push(buildError("duplicate_path", normalizedPath, "Файл уже обработан"));
          return { imported: false, skipped: true };
        }

        const fileName = segments[segments.length - 1];
        const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

        if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
          errors.push(buildError("unsupported_type", normalizedPath, "Формат файла не поддерживается"));
          return { imported: false, skipped: true };
        }

        try {
          const buffer = await archiveFile.arrayBuffer();
          const { title, html } = await convertBufferToHtml({ data: buffer, filename: fileName });
          const sanitizedContent = getSanitizedContent(html);

          if (!sanitizedContent.trim()) {
            errors.push(buildError("empty_document", normalizedPath, "Документ не содержит контента"));
            return { imported: false, skipped: true };
          }

          const documentId = createRandomId();
          documents[documentId] = {
            id: documentId,
            title,
            content: sanitizedContent,
            updatedAt: new Date().toISOString(),
            vectorization: null,
            chunkSet: null,
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
          return { imported: true, skipped: false };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Не удалось обработать документ";
          errors.push(buildError("failed_conversion", normalizedPath, message));
          return { imported: false, skipped: true };
        }
      }),
    );

    // Подсчитываем результаты
    totalFiles = allFiles.length;
    importedFiles = results.filter((r) => r.imported).length;
    skippedFiles = results.filter((r) => r.skipped).length;

    return { totalFiles, importedFiles, skippedFiles };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Не удалось обработать архив";
    errors.push(buildError("failed_conversion", file.name, message));
    return { totalFiles, importedFiles, skippedFiles };
  }
};

export const importKnowledgeArchive = async (file: File): Promise<ArchiveImportResult> => {
  const startedAt = new Date().toISOString();
  const rootNodes: TreeNode[] = [];
  const folderMap = new Map<string, FolderNode>();
  const documents: Record<string, KnowledgeDocument> = {};
  const createdDocumentByPath = new Map<string, string>();
  const errors: KnowledgeBaseImportError[] = [];

  // Проверяем формат архива
  const archiveType = getArchiveType(file.name);
  
  let totalFiles = 0;
  let importedFiles = 0;
  let skippedFiles = 0;

  // Если это RAR или 7z, используем libarchive.js
  if (archiveType === "rar" || archiveType === "7z") {
    const result = await processArchiveWithLibArchive(
      file,
      rootNodes,
      folderMap,
      documents,
      createdDocumentByPath,
      errors,
    );
    totalFiles = result.totalFiles;
    importedFiles = result.importedFiles;
    skippedFiles = result.skippedFiles;
  } else {
    // Для ZIP и неизвестных форматов сначала пробуем ZIP
    const isZip = archiveType === "zip" || (archiveType === "unknown" && (await isZipFile(file)));

    if (isZip) {
      // Загружаем ZIP архив через JSZip
      let zip;
      try {
        zip = await JSZip.loadAsync(file);
      } catch (error) {
        // Если ZIP не загрузился, пробуем через libarchive.js
        if (archiveType === "unknown") {
          const result = await processArchiveWithLibArchive(
            file,
            rootNodes,
            folderMap,
            documents,
            createdDocumentByPath,
            errors,
          );
          totalFiles = result.totalFiles;
          importedFiles = result.importedFiles;
          skippedFiles = result.skippedFiles;
        } else {
          // Обрабатываем ошибки загрузки ZIP
          const errorMessage =
            error instanceof Error && error.message.includes("central directory")
              ? "Файл не является ZIP архивом или архив поврежден. Пожалуйста, используйте ZIP архив."
              : error instanceof Error
                ? `Не удалось загрузить архив: ${error.message}`
                : "Не удалось загрузить архив. Пожалуйста, убедитесь, что файл является корректным ZIP архивом.";

          const summary: KnowledgeBaseImportSummary = {
            totalFiles: 0,
            importedFiles: 0,
            skippedFiles: 0,
            errors: [buildError("failed_conversion", file.name, errorMessage)],
            archiveName: file.name,
            startedAt,
            completedAt: new Date().toISOString(),
          };

          return {
            structure: rootNodes,
            documents,
            errors: summary.errors,
            summary,
          };
        }
      }

      if (zip) {
        // Обрабатываем ZIP через JSZip
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
              chunkSet: null,
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
      }
    } else {
      // Неизвестный формат, пробуем через libarchive.js
      const result = await processArchiveWithLibArchive(
        file,
        rootNodes,
        folderMap,
        documents,
        createdDocumentByPath,
        errors,
      );
      totalFiles = result.totalFiles;
      importedFiles = result.importedFiles;
      skippedFiles = result.skippedFiles;
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


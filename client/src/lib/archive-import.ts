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

// Поддержка RAR/7z временно отключена
// TODO: Добавить поддержку через альтернативную библиотеку (например, uncompress.js или node-unrar-js)

type FolderNode = TreeNode & { children: TreeNode[] };

// Константы безопасности
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ на файл
const MAX_TOTAL_FILES = 10000; // Максимум файлов в архиве
const MAX_PATH_DEPTH = 50; // Максимальная глубина вложенности
const MAX_FILENAME_LENGTH = 255; // Максимальная длина имени файла
const MAX_ARCHIVE_SIZE = 500 * 1024 * 1024; // 500 МБ общий размер архива

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

  // Проверка глубины вложенности
  if (segments.length > MAX_PATH_DEPTH) {
    return null;
  }

  const safeSegments: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      return null;
    }

    if (INVALID_SEGMENT_PATTERN.test(segment)) {
      return null;
    }

    // Проверка длины имени файла/папки
    if (segment.length > MAX_FILENAME_LENGTH) {
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

// Функции для обработки RAR/7z временно удалены
// TODO: Добавить поддержку RAR/7z через альтернативную библиотеку

export const importKnowledgeArchive = async (file: File): Promise<ArchiveImportResult> => {
  const startedAt = new Date().toISOString();
  const rootNodes: TreeNode[] = [];
  const folderMap = new Map<string, FolderNode>();
  const documents: Record<string, KnowledgeDocument> = {};
  const createdDocumentByPath = new Map<string, string>();
  const errors: KnowledgeBaseImportError[] = [];

  // Проверка размера архива
  if (file.size > MAX_ARCHIVE_SIZE) {
    const errorMessage = `Размер архива превышает максимально допустимый (${MAX_ARCHIVE_SIZE / 1024 / 1024} МБ)`;
    const summary: KnowledgeBaseImportSummary = {
      totalFiles: 0,
      importedFiles: 0,
      skippedFiles: 0,
      errors: [buildError("unsupported_type", file.name, errorMessage)],
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

  // Проверяем формат архива
  const archiveType = getArchiveType(file.name);
  
  let totalFiles = 0;
  let importedFiles = 0;
  let skippedFiles = 0;

  // Проверка количества файлов перед обработкой (для ZIP)
  // Для RAR/7z проверка будет внутри processArchiveWithLibArchive

  // Если это RAR или 7z, выдаем ошибку (поддержка временно отключена)
  if (archiveType === "rar" || archiveType === "7z") {
    const archiveTypeName = archiveType === "rar" ? "RAR" : "7z";
    const errorMessage = `Формат архива ${archiveTypeName} временно не поддерживается. Пожалуйста, конвертируйте архив в ZIP формат перед импортом.`;
    
    const summary: KnowledgeBaseImportSummary = {
      totalFiles: 0,
      importedFiles: 0,
      skippedFiles: 0,
      errors: [buildError("unsupported_type", file.name, errorMessage)],
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
  } else {
    // Для ZIP и неизвестных форматов сначала пробуем ZIP
    const isZip = archiveType === "zip" || (archiveType === "unknown" && (await isZipFile(file)));

    if (isZip) {
      // Загружаем ZIP архив через JSZip
      let zip;
      try {
        zip = await JSZip.loadAsync(file);
      } catch (error) {
        // Если ZIP не загрузился и формат неизвестен, выдаем ошибку
        if (archiveType === "unknown") {
          const errorMessage = "Файл не является ZIP архивом. Пожалуйста, используйте ZIP архив.";
          
          const summary: KnowledgeBaseImportSummary = {
            totalFiles: 0,
            importedFiles: 0,
            skippedFiles: 0,
            errors: [buildError("unsupported_type", file.name, errorMessage)],
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

        // Проверка количества файлов (защита от bomb-атак)
        if (entries.length > MAX_TOTAL_FILES) {
          const errorMessage = `Количество файлов в архиве превышает максимально допустимое (${MAX_TOTAL_FILES})`;
          const summary: KnowledgeBaseImportSummary = {
            totalFiles: 0,
            importedFiles: 0,
            skippedFiles: 0,
            errors: [buildError("unsupported_type", file.name, errorMessage)],
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
            // Проверка размера файла перед загрузкой
            if (entry.uncompressedSize > MAX_FILE_SIZE) {
              errors.push(
                buildError(
                  "unsupported_type",
                  normalizedPath,
                  `Размер файла превышает максимально допустимый (${MAX_FILE_SIZE / 1024 / 1024} МБ)`,
                ),
              );
              skippedFiles += 1;
              continue;
            }

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
      // Неизвестный формат - выдаем ошибку
      const errorMessage = "Файл не является ZIP архивом. Пожалуйста, используйте ZIP архив.";
      
      const summary: KnowledgeBaseImportSummary = {
        totalFiles: 0,
        importedFiles: 0,
        skippedFiles: 0,
        errors: [buildError("unsupported_type", file.name, errorMessage)],
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


import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { convertFileToHtml, getSanitizedContent } from "@/lib/document-import";
import { importKnowledgeArchive } from "@/lib/archive-import";

export type BulkDocumentInput = {
  title: string;
  content: string;
  parentId?: string | null;
  sourceType?: 'manual' | 'import';
  importFileName?: string | null;
};

export type BulkImportResult = {
  success: boolean;
  created: string[];
  failed: string[];
  errors: Array<{ title: string; error: string }>;
};

export function useBulkDocumentImport(workspaceId: string, baseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      files: File[];
      parentId?: string | null;
      isArchive?: boolean;
    }): Promise<BulkImportResult> => {
      const { files, parentId, isArchive = false } = params;

      let documents: BulkDocumentInput[];

      if (isArchive && files.length === 1) {
        // Обработка архива
        const archiveFile = files[0];
        const archiveResult = await importKnowledgeArchive(archiveFile);

        // Проверяем наличие критических ошибок (например, неподдерживаемый формат)
        if (archiveResult.errors.length > 0 && Object.keys(archiveResult.documents).length === 0) {
          // Если нет документов и есть ошибки, это критическая ошибка
          const errorMessages = archiveResult.errors.map(err => err.message).join('; ');
          throw new Error(`Не удалось импортировать архив: ${errorMessages}`);
        }

        // Преобразуем в плоский список документов (игнорируем структуру папок)
        documents = Object.values(archiveResult.documents).map((doc) => ({
          title: doc.title,
          content: doc.content,
          parentId: parentId ?? null,
          sourceType: 'import' as const,
          importFileName: archiveFile.name,
        }));

        // Если есть ошибки, но документы импортированы, добавляем их в результат
        if (archiveResult.errors.length > 0) {
          // Ошибки будут отображены через summary, но мы можем их обработать здесь
          // Пока просто продолжаем с импортированными документами
        }
      } else {
        // Обработка множественных файлов
        documents = await Promise.all(
          files.map(async (file) => {
            const { title, html } = await convertFileToHtml(file);
            const content = getSanitizedContent(html);
            return {
              title,
              content,
              parentId: parentId ?? null,
              sourceType: 'import' as const,
              importFileName: file.name,
            };
          })
        );
      }

      // Отправить на сервер
      const response = await apiRequest(
        'POST',
        `/api/knowledge/bases/${baseId}/documents/bulk`,
        { documents },
        undefined,
        { workspaceId }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Не удалось импортировать документы');
      }

      return (await response.json()) as BulkImportResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-node', baseId] });
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importKnowledgeArchive, type ArchiveImportResult } from "@/lib/archive-import";
import {
  createKnowledgeBaseEntry,
  readKnowledgeBaseStorage,
  writeKnowledgeBaseStorage,
  type KnowledgeBase,
  type KnowledgeBaseIngestion,
  type KnowledgeBaseImportSummary,
  type KnowledgeBaseSourceType,
  type KnowledgeBaseTaskSummary,
} from "@/lib/knowledge-base";
import { apiRequest } from "@/lib/queryClient";
import type {
  CreateKnowledgeBaseResponse,
  KnowledgeBaseCrawlJobStatus,
  KnowledgeBaseSummary,
} from "@shared/knowledge-base";

export type CreateKnowledgeBaseInput = {
  name: string;
  description?: string;
  mode: KnowledgeBaseSourceType;
  archiveFile?: File | null;
  crawlerConfig?: CreateKnowledgeBaseCrawlerConfig;
};

export type CreateKnowledgeBaseResult = KnowledgeBase;

export type CreateKnowledgeBaseCrawlerConfig = {
  startUrls: string[];
  sitemapUrl?: string;
  allowedDomains?: string[];
  include?: string[];
  exclude?: string[];
  maxPages?: number;
  maxDepth?: number;
  rateLimitRps?: number;
  robotsTxt?: boolean;
  selectors?: { title?: string; content?: string };
  language?: string;
  version?: string;
  authHeaders?: Record<string, string>;
};

export function useCreateKnowledgeBase(workspaceId?: string | null) {
  const queryClient = useQueryClient();
  const resolveWorkspaceId = (explicit?: string | null): string => {
    if (explicit?.trim()) {
      return explicit.trim();
    }

    const session = queryClient.getQueryData<{ workspace?: { active?: { id?: string } }; activeWorkspaceId?: string | null }>([
      "/api/auth/session",
    ]);
    const cached = session?.workspace?.active?.id ?? session?.activeWorkspaceId;
    if (cached && cached.trim().length > 0) {
      return cached.trim();
    }

    throw new Error("Не выбрано рабочее пространство");
  };

  return useMutation<CreateKnowledgeBaseResult, Error, CreateKnowledgeBaseInput>({
    mutationFn: async ({ name, description, mode, archiveFile, crawlerConfig }) => {
      const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Укажите название базы знаний");
      }

      let ingestion: KnowledgeBaseIngestion | undefined;
      let importSummary: KnowledgeBaseImportSummary | undefined;
      let structure: ArchiveImportResult["structure"] | undefined;
      let documents: ArchiveImportResult["documents"] | undefined;
      let tasks: KnowledgeBaseTaskSummary | undefined;
      if (mode === "json_import") {
        // Для json_import просто создаем базу, импорт будет выполнен через визард
        ingestion = { type: "json_import" };
      } else if (mode === "archive") {
        if (!archiveFile) {
          throw new Error("Выберите архив документов для импорта");
        }

        const archiveImport = await importKnowledgeArchive(archiveFile);
        
        // Проверяем наличие критических ошибок (например, неподдерживаемый формат)
        if (archiveImport.errors.length > 0 && archiveImport.summary.importedFiles === 0) {
          const errorMessages = archiveImport.errors.map(err => err.message).join('; ');
          throw new Error(`Не удалось импортировать архив: ${errorMessages}`);
        }
        
        if (archiveImport.summary.importedFiles === 0) {
          throw new Error(
            "Не удалось импортировать ни один документ из архива. Проверьте поддерживаемые форматы и структуру файлов.",
          );
        }

        ingestion = { type: "archive", archiveName: archiveFile.name };
        importSummary = archiveImport.summary;
        structure = archiveImport.structure;
        documents = archiveImport.documents;
        tasks = {
          total: archiveImport.summary.totalFiles,
          inProgress: archiveImport.summary.skippedFiles,
          completed: archiveImport.summary.importedFiles,
        };
      } else if (mode === "crawler") {
        if (!crawlerConfig || crawlerConfig.startUrls.length === 0) {
          throw new Error("Укажите стартовые URL для краулинга");
        }

        ingestion = { type: "crawler", seedUrl: crawlerConfig.startUrls[0] };
      }

      let base = createKnowledgeBaseEntry({
        name: trimmedName,
        description: description?.trim() || undefined,
        sourceType: mode,
        ingestion,
        importSummary,
      });

      if (structure) {
        base = { ...base, structure };
      }

      if (documents) {
        base = { ...base, documents };
      }

      if (tasks) {
        base = { ...base, tasks };
      }

      let remoteSummary: CreateKnowledgeBaseResponse | null = null;

      if (mode === "crawler" && crawlerConfig) {
        const payload: Record<string, unknown> = {
          name: base.name,
          description: base.description,
          source: "crawl",
          crawl_config: {
            start_urls: crawlerConfig.startUrls,
            sitemap_url: crawlerConfig.sitemapUrl,
            allowed_domains: crawlerConfig.allowedDomains,
            include: crawlerConfig.include,
            exclude: crawlerConfig.exclude,
            max_pages: crawlerConfig.maxPages,
            max_depth: crawlerConfig.maxDepth,
            rate_limit_rps: crawlerConfig.rateLimitRps,
            robots_txt: crawlerConfig.robotsTxt,
            selectors: crawlerConfig.selectors,
            language: crawlerConfig.language,
            version: crawlerConfig.version,
            auth: crawlerConfig.authHeaders ? { headers: crawlerConfig.authHeaders } : undefined,
          },
        };

        const response = await apiRequest("POST", "/api/kb", payload, undefined, { workspaceId: resolvedWorkspaceId });
        const created = (await response.json()) as {
          kb_id: string;
          knowledge_base: CreateKnowledgeBaseResponse;
          job?: KnowledgeBaseCrawlJobStatus;
        };

        const summary = created.knowledge_base;
        remoteSummary = summary;
        base = {
          ...base,
          id: summary.id,
          name: summary.name,
          description: summary.description,
          createdAt: summary.updatedAt,
          updatedAt: summary.updatedAt,
        };

        const crawlJob = created.job;
        if (crawlJob) {
          base = { ...base, crawlJob };
        }
      } else {
        const response = await apiRequest(
          "POST",
          "/api/knowledge/bases",
          {
            id: base.id,
            name: base.name,
            description: base.description,
            workspaceId: resolvedWorkspaceId,
          },
          undefined,
          { workspaceId: resolvedWorkspaceId },
        );

        const created = (await response.json()) as CreateKnowledgeBaseResponse;
        remoteSummary = created;
        base = {
          ...base,
          id: created.id,
          name: created.name,
          description: created.description,
          createdAt: created.updatedAt,
          updatedAt: created.updatedAt,
        };

        // Если есть документы из архива, отправляем их на сервер
        if (documents && Object.keys(documents).length > 0 && structure) {
          try {
            // Сначала создаем папки и сохраняем их ID
            const folderMap = new Map<string, string>(); // Map<localId, serverId>
            
            const createFoldersRecursively = async (nodes: typeof structure, parentId: string | null = null): Promise<void> => {
              for (const node of nodes) {
                if (node.type === 'folder') {
                  try {
                    const folderResponse = await apiRequest(
                      'POST',
                      `/api/knowledge/bases/${created.id}/folders`,
                      {
                        name: node.title,
                        parentId: parentId || undefined,
                      },
                      undefined,
                      { workspaceId: resolvedWorkspaceId },
                    );

                    if (folderResponse.ok) {
                      const folderData = await folderResponse.json();
                      const serverFolderId = folderData.folder?.id || folderData.id;
                      if (serverFolderId) {
                        folderMap.set(node.id, serverFolderId);
                        // Рекурсивно создаем вложенные папки и документы
                        if (node.children) {
                          await createFoldersRecursively(node.children, serverFolderId);
                        }
                      }
                    }
                  } catch (error) {
                    console.warn(`Не удалось создать папку "${node.title}":`, error);
                    // Продолжаем создание остальных элементов
                  }
                } else if (node.type === 'document' && node.documentId && documents[node.documentId]) {
                  // Документы будут созданы после создания всех папок
                }
              }
            };

            // Создаем все папки
            await createFoldersRecursively(structure);

            // Теперь собираем документы с правильными parentId
            const documentsToCreate: Array<{
              title: string;
              content: string;
              parentId: string | null;
              sourceType: 'import';
              importFileName: string | null;
            }> = [];

            const collectDocuments = (nodes: typeof structure, parentId: string | null = null) => {
              for (const node of nodes) {
                if (node.type === 'document' && node.documentId && documents[node.documentId]) {
                  const doc = documents[node.documentId];
                  documentsToCreate.push({
                    title: doc.title,
                    content: doc.content,
                    parentId,
                    sourceType: 'import' as const,
                    importFileName: archiveFile?.name || null,
                  });
                } else if (node.type === 'folder') {
                  // Используем serverId папки из folderMap
                  const serverFolderId = folderMap.get(node.id) || null;
                  if (node.children) {
                    collectDocuments(node.children, serverFolderId);
                  }
                }
              }
            };

            collectDocuments(structure);

            // Отправляем документы на сервер батчами
            if (documentsToCreate.length > 0) {
              const bulkResponse = await apiRequest(
                'POST',
                `/api/knowledge/bases/${created.id}/documents/bulk`,
                { documents: documentsToCreate },
                undefined,
                { workspaceId: resolvedWorkspaceId },
              );

              if (!bulkResponse.ok) {
                const errorData = await bulkResponse.json().catch(() => ({}));
                console.warn('Не удалось создать некоторые документы из архива:', errorData);
                // Не бросаем ошибку, чтобы база знаний все равно была создана
              }
            }
          } catch (error) {
            console.error('Ошибка при создании документов из архива:', error);
            // Не бросаем ошибку, чтобы база знаний все равно была создана
          }
        }
      }

      const currentState = readKnowledgeBaseStorage();
      const updatedState = {
        knowledgeBases: [...currentState.knowledgeBases, base],
        selectedBaseId: base.id,
        selectedDocument: null,
      };

      writeKnowledgeBaseStorage(updatedState);
      return base;
    },
    onSuccess: async (createdBase) => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const [key, baseId] = query.queryKey as [unknown, unknown];
          return key === "knowledge-node" && baseId === createdBase.id;
        },
      });
    },
  });
}

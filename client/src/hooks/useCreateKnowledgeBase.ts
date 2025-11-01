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

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();

  return useMutation<CreateKnowledgeBaseResult, Error, CreateKnowledgeBaseInput>({
    mutationFn: async ({ name, description, mode, archiveFile, crawlerConfig }) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Укажите название базы знаний");
      }

      let ingestion: KnowledgeBaseIngestion | undefined;
      let importSummary: KnowledgeBaseImportSummary | undefined;
      let structure: ArchiveImportResult["structure"] | undefined;
      let documents: ArchiveImportResult["documents"] | undefined;
      let tasks: KnowledgeBaseTaskSummary | undefined;
      if (mode === "archive") {
        if (!archiveFile) {
          throw new Error("Выберите архив документов для импорта");
        }

        const archiveImport = await importKnowledgeArchive(archiveFile);
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

        const response = await apiRequest("POST", "/api/kb", payload);
        const created = (await response.json()) as {
          kb_id: string;
          knowledge_base: CreateKnowledgeBaseResponse;
          job?: KnowledgeBaseCrawlJobStatus;
        };

        const summary = created.knowledge_base;
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
        const response = await apiRequest("POST", "/api/knowledge/bases", {
          id: base.id,
          name: base.name,
          description: base.description,
        });

        const created = (await response.json()) as CreateKnowledgeBaseResponse;
        base = {
          ...base,
          id: created.id,
          name: created.name,
          description: created.description,
          createdAt: created.updatedAt,
          updatedAt: created.updatedAt,
        };
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

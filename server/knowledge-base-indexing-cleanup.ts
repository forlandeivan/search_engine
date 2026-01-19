import { storage } from "./storage";
import { knowledgeBaseIndexingActionsService } from "./knowledge-base-indexing-actions";
import { knowledgeBaseIndexingStateService } from "./knowledge-base-indexing-state";
import { getKnowledgeBaseById } from "./knowledge-base";
import { getQdrantClient } from "./qdrant";
import { resolveEmbeddingProviderStatus } from "./embedding-provider-registry";
import { knowledgeBaseIndexingPolicyService } from "./knowledge-base-indexing-policy";
import { log } from "./vite";

const CLEANUP_LOG_TYPE = "knowledge_base_indexing_cleanup";

function cleanupLog(message: string): void {
  log(message, CLEANUP_LOG_TYPE);
}

export interface CleanupResult {
  deletedVectors: number;
  deletedRevisions: number;
  restoredDocuments: number;
  errors: string[];
}

function buildKnowledgeCollectionName(
  base: { id?: string | null; name?: string | null } | null | undefined,
  providerId: string,
  workspaceId: string,
): string {
  const baseId = base?.id;
  if (!baseId) {
    throw new Error("База знаний должна иметь ID для создания коллекции");
  }
  const baseSlug = baseId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 60) || "default";
  const workspaceSlug = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 60) || "default";
  return `kb_${baseSlug}_ws_${workspaceSlug}`;
}

export async function deleteIndexedDataForAction(
  workspaceId: string,
  baseId: string,
  actionId: string,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deletedVectors: 0,
    deletedRevisions: 0,
    restoredDocuments: 0,
    errors: [],
  };

  try {
    // 1. Получить action для определения временного окна
    const action = await knowledgeBaseIndexingActionsService.get(workspaceId, baseId, actionId);
    if (!action) {
      throw new Error("Action не найден");
    }

    cleanupLog(`Starting cleanup for action ${actionId}, workspace=${workspaceId}, base=${baseId}`);

    // 2. Получить базу знаний
    const base = await getKnowledgeBaseById(workspaceId, baseId);
    if (!base) {
      throw new Error("База знаний не найдена");
    }

    // 3. Получить политику индексации для определения провайдера
    const policy = await knowledgeBaseIndexingPolicyService.get();
    if (!policy?.embeddingsProvider) {
      throw new Error("Политика индексации не найдена или провайдер не указан");
    }

    const providerId = policy.embeddingsProvider;
    const providerStatus = await resolveEmbeddingProviderStatus(providerId, undefined);
    if (!providerStatus?.isConfigured) {
      throw new Error(`Провайдер эмбеддингов '${providerId}' недоступен`);
    }

    // 4. Получить список jobs, завершённых успешно в рамках этого action
    const actionRecord = await storage.getKnowledgeBaseIndexingAction(workspaceId, baseId, actionId);
    if (!actionRecord) {
      throw new Error("Action record не найден");
    }

    const completedJobs = await storage.getKnowledgeBaseIndexingJobsByAction(
      workspaceId,
      baseId,
      actionRecord.createdAt,
      actionRecord.updatedAt,
    );

    const successfulJobs = completedJobs.filter((job) => job.status === "completed");
    cleanupLog(`Found ${successfulJobs.length} completed jobs to cleanup`);

    if (successfulJobs.length === 0) {
      cleanupLog("No completed jobs to cleanup");
      return result;
    }

    // 5. Получить коллекцию Qdrant
    const collectionName = buildKnowledgeCollectionName(base, providerId, workspaceId);
    const qdrantClient = getQdrantClient();

    // 6. Для каждого успешного job
    for (const job of successfulJobs) {
      try {
        // a) Получить revision созданную для этого job
        const revisions = await storage.getKnowledgeDocumentIndexRevisions(
          workspaceId,
          job.documentId,
        );

        // Находим revision, созданную в рамках этого action
        const revision = revisions.find(
          (r) =>
            r.createdAt >= actionRecord.createdAt &&
            r.createdAt <= actionRecord.updatedAt &&
            (r.status === "ready" || r.status === "processing"),
        );

        if (!revision) {
          cleanupLog(`No revision found for job ${job.id}, document ${job.documentId}`);
          continue;
        }

        // b) Удалить векторы из Qdrant по revision_id
        try {
          await qdrantClient.delete(collectionName, {
            wait: true,
            filter: {
              must: [{ key: "revision_id", match: { value: revision.id } }],
            },
          });
          result.deletedVectors += revision.chunkCount ?? 0;
          cleanupLog(
            `Deleted ${revision.chunkCount ?? 0} vectors for revision ${revision.id}, document ${job.documentId}`,
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          cleanupLog(`Failed to delete vectors for revision ${revision.id}: ${errorMsg}`);
          result.errors.push(`Document ${job.documentId}: ошибка удаления векторов: ${errorMsg}`);
        }

        // c) Удалить revision из БД
        try {
          await storage.deleteKnowledgeDocumentIndexRevision(workspaceId, job.documentId, revision.id);
          result.deletedRevisions += 1;
          cleanupLog(`Deleted revision ${revision.id} for document ${job.documentId}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          cleanupLog(`Failed to delete revision ${revision.id}: ${errorMsg}`);
          result.errors.push(`Document ${job.documentId}: ошибка удаления ревизии: ${errorMsg}`);
        }

        // d) Откатить статус документа
        try {
          await knowledgeBaseIndexingStateService.markDocumentOutdated(
            workspaceId,
            baseId,
            job.documentId,
          );
          result.restoredDocuments += 1;
          cleanupLog(`Marked document ${job.documentId} as outdated`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          cleanupLog(`Failed to mark document ${job.documentId} as outdated: ${errorMsg}`);
          result.errors.push(`Document ${job.documentId}: ошибка отката статуса: ${errorMsg}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        cleanupLog(`Error processing job ${job.id}: ${errorMsg}`);
        result.errors.push(`Job ${job.id}: ${errorMsg}`);
      }
    }

    // 7. Пересчитать статус базы
    try {
      await knowledgeBaseIndexingStateService.recalculateBaseState(workspaceId, baseId);
      cleanupLog("Recalculated base state");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      cleanupLog(`Failed to recalculate base state: ${errorMsg}`);
      result.errors.push(`Ошибка пересчёта статуса базы: ${errorMsg}`);
    }

    cleanupLog(
      `Cleanup completed: deleted ${result.deletedVectors} vectors, ${result.deletedRevisions} revisions, restored ${result.restoredDocuments} documents, ${result.errors.length} errors`,
    );

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    cleanupLog(`Fatal error in cleanup: ${errorMsg}`);
    result.errors.push(`Критическая ошибка: ${errorMsg}`);
    throw error;
  }
}

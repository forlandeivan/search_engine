import { randomUUID } from "crypto";
import { storage } from "./storage";
import { KnowledgeBaseError } from "./knowledge-base";
import type {
  KnowledgeBaseIndexingAction,
  KnowledgeBaseIndexingActionRecord,
  KnowledgeBaseIndexingActionInsert,
  IndexingStage,
  KnowledgeBaseIndexingActionStatus,
  IndexingLogResponse,
} from "@shared/schema";

function mapToDto(row: KnowledgeBaseIndexingActionRecord): KnowledgeBaseIndexingAction {
  return {
    workspaceId: row.workspaceId,
    baseId: row.baseId,
    actionId: row.actionId,
    status: row.status,
    stage: row.stage,
    displayText: row.displayText ?? null,
    payload: row.payload ?? null,
    userId: row.userId ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export class KnowledgeBaseIndexingActionsService {
  async start(
    workspaceId: string,
    baseId: string,
    actionId?: string,
    initialStage: IndexingStage = "initializing",
    userId?: string | null,
  ): Promise<KnowledgeBaseIndexingAction> {
    const effectiveActionId = actionId ?? randomUUID();
    const now = new Date();

    const record: KnowledgeBaseIndexingActionInsert = {
      workspaceId,
      baseId,
      actionId: effectiveActionId,
      status: "processing",
      stage: initialStage,
      displayText: null,
      payload: {},
      userId: userId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await storage.createKnowledgeBaseIndexingAction(record);
      if (!created) {
        // Если уже существует, получаем существующий
        const existing = await storage.getKnowledgeBaseIndexingAction(workspaceId, baseId, effectiveActionId);
        if (existing) {
          return mapToDto(existing);
        }
        throw new KnowledgeBaseError("Не удалось создать статус индексации", 500);
      }

      return mapToDto(created);
    } catch (error) {
      console.error(`[KnowledgeBaseIndexingActionsService.start] Failed to create action for baseId: ${baseId}, workspaceId: ${workspaceId}, actionId: ${effectiveActionId}`, error);
      if (error instanceof KnowledgeBaseError) {
        throw error;
      }
      throw new KnowledgeBaseError(
        `Не удалось создать статус индексации: ${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }

  async update(
    workspaceId: string,
    baseId: string,
    actionId: string,
    updates: {
      status?: KnowledgeBaseIndexingActionStatus;
      stage?: IndexingStage;
      displayText?: string | null;
      payload?: Record<string, unknown> | null;
    },
  ): Promise<KnowledgeBaseIndexingAction | null> {
    const updateData: Partial<KnowledgeBaseIndexingActionInsert> = {
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.stage !== undefined && { stage: updates.stage }),
      ...(updates.displayText !== undefined && { displayText: updates.displayText }),
      ...(updates.payload !== undefined && { payload: updates.payload }),
    };

    const updated = await storage.updateKnowledgeBaseIndexingAction(
      workspaceId,
      baseId,
      actionId,
      updateData,
    );

    return updated ? mapToDto(updated) : null;
  }

  async get(workspaceId: string, baseId: string, actionId: string): Promise<KnowledgeBaseIndexingAction | null> {
    const record = await storage.getKnowledgeBaseIndexingAction(workspaceId, baseId, actionId);
    return record ? mapToDto(record) : null;
  }

  async getLatest(workspaceId: string, baseId: string): Promise<KnowledgeBaseIndexingAction | null> {
    const record = await storage.getLatestKnowledgeBaseIndexingAction(workspaceId, baseId);
    return record ? mapToDto(record) : null;
  }

  async listHistory(
    workspaceId: string,
    baseId: string,
    limit: number = 25,
  ): Promise<Array<KnowledgeBaseIndexingAction & {
    userName: string | null;
    userEmail: string | null;
    totalDocuments: number;
    processedDocuments: number;
    failedDocuments: number;
    totalChunks: number;
  }>> {
    const actions = await storage.listKnowledgeBaseIndexingActionsHistory(workspaceId, baseId, limit);
    
    const result = await Promise.all(
      actions.map(async (action) => {
        const dto = mapToDto(action);
        
        // Получаем статистику из jobs
        const stats = await storage.getKnowledgeBaseIndexingJobsStatsForAction(
          workspaceId,
          baseId,
          action.createdAt,
          action.updatedAt,
        );
        
        // Получаем информацию о пользователе, если userId не null
        let userName: string | null = null;
        let userEmail: string | null = null;
        if (action.userId) {
          try {
            const user = await storage.getUserById(action.userId);
            if (user) {
              userName = user.fullName;
              userEmail = user.email;
            }
          } catch (error) {
            console.error(`[KnowledgeBaseIndexingActionsService.listHistory] Failed to get user ${action.userId}:`, error);
          }
        }
        
        return {
          ...dto,
          userName,
          userEmail,
          ...stats,
        };
      }),
    );
    
    return result;
  }

  async getLogs(
    workspaceId: string,
    baseId: string,
    actionId: string,
  ): Promise<IndexingLogResponse | null> {
    // Получаем action
    const action = await storage.getKnowledgeBaseIndexingAction(workspaceId, baseId, actionId);
    if (!action) {
      return null;
    }

    const dto = mapToDto(action);

    // Получаем статистику
    const stats = await storage.getKnowledgeBaseIndexingJobsStatsForAction(
      workspaceId,
      baseId,
      action.createdAt,
      action.updatedAt,
    );

    // Получаем информацию о пользователе
    let userName: string | null = null;
    let userEmail: string | null = null;
    if (action.userId) {
      try {
        const user = await storage.getUserById(action.userId);
        if (user) {
          userName = user.fullName;
          userEmail = user.email;
        }
      } catch (error) {
        console.error(`[KnowledgeBaseIndexingActionsService.getLogs] Failed to get user ${action.userId}:`, error);
      }
    }

    // Получаем jobs с информацией о документах
    const jobs = await storage.getKnowledgeBaseIndexingJobsByAction(
      workspaceId,
      baseId,
      action.createdAt,
      action.updatedAt,
    );

    const payload = (dto.payload ?? {}) as Record<string, unknown>;
    const config = (payload.config ?? {}) as Record<string, unknown>;
    const events = (Array.isArray(payload.events) ? payload.events : []) as Array<{
      timestamp: string;
      stage: string;
      message: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }>;
    const errors = (Array.isArray(payload.errors) ? payload.errors : []) as Array<{
      documentId: string;
      documentTitle: string;
      error: string;
      stage: string;
      timestamp: string;
    }>;

    return {
      actionId: dto.actionId,
      summary: {
        status: dto.status,
        stage: dto.stage,
        displayText: dto.displayText,
        startedAt: dto.createdAt ?? new Date().toISOString(),
        finishedAt: dto.status === "processing" ? null : dto.updatedAt,
        userId: dto.userId,
        userName,
        userEmail,
        ...stats,
      },
      config: Object.keys(config).length > 0 ? config : null,
      events: events.length > 0 ? events : null,
      errors: errors.length > 0 ? errors : null,
      jobs: jobs.map((job) => ({
        jobId: job.id,
        documentId: job.documentId,
        documentTitle: job.documentTitle ?? "Без названия",
        versionId: job.versionId,
        status: job.status,
        chunkCount: job.chunkCount,
        totalChars: job.totalChars,
        totalTokens: job.totalTokens,
        error: job.lastError,
        attempts: job.attempts,
        startedAt: job.createdAt ? job.createdAt.toISOString() : null,
        finishedAt: job.status === "completed" || job.status === "failed" ? (job.updatedAt ? job.updatedAt.toISOString() : null) : null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
    };
  }

  async cancel(
    workspaceId: string,
    baseId: string,
    actionId?: string,
  ): Promise<{
    success: boolean;
    actionId: string;
    canceledJobs: number;
    completedJobs: number;
    message: string;
  }> {
    // Получаем активный action
    const action = actionId
      ? await this.get(workspaceId, baseId, actionId)
      : await this.getLatest(workspaceId, baseId);

    if (!action) {
      throw new KnowledgeBaseError("Нет активной индексации для отмены", 400);
    }

    if (action.status !== "processing" && action.status !== "paused") {
      throw new KnowledgeBaseError(
        `Индексация не может быть отменена. Текущий статус: ${action.status}`,
        400,
      );
    }

    // Обновляем статус action на canceled
    const updated = await this.update(workspaceId, baseId, action.actionId, {
      status: "canceled",
      displayText: "Индексация отменена пользователем",
    });

    if (!updated) {
      throw new KnowledgeBaseError("Не удалось обновить статус индексации", 500);
    }

    // Получаем статистику jobs
    const actionRecord = await storage.getKnowledgeBaseIndexingAction(
      workspaceId,
      baseId,
      action.actionId,
    );
    if (!actionRecord) {
      throw new KnowledgeBaseError("Action не найден после обновления", 500);
    }

    // Помечаем все pending jobs как canceled
    const canceledCount = await storage.cancelPendingKnowledgeBaseIndexingJobs(
      workspaceId,
      baseId,
      actionRecord.createdAt,
      actionRecord.updatedAt,
    );

    // Получаем статистику завершённых jobs
    const stats = await storage.getKnowledgeBaseIndexingJobsStatsForAction(
      workspaceId,
      baseId,
      actionRecord.createdAt,
      actionRecord.updatedAt,
    );

    return {
      success: true,
      actionId: action.actionId,
      canceledJobs: canceledCount,
      completedJobs: stats.processedDocuments,
      message: `Индексация отменена. Обработано ${stats.processedDocuments} документов, отменено ${canceledCount}.`,
    };
  }

  async pause(
    workspaceId: string,
    baseId: string,
    actionId?: string,
  ): Promise<{
    success: boolean;
    actionId: string;
    status: KnowledgeBaseIndexingActionStatus;
    processedDocuments: number;
    pendingDocuments: number;
    message: string;
  }> {
    const action = actionId
      ? await this.get(workspaceId, baseId, actionId)
      : await this.getLatest(workspaceId, baseId);

    if (!action) {
      throw new KnowledgeBaseError("Нет активной индексации", 400);
    }

    if (action.status !== "processing") {
      throw new KnowledgeBaseError(
        `Индексация не может быть приостановлена. Текущий статус: ${action.status}`,
        400,
      );
    }

    const updated = await this.update(workspaceId, baseId, action.actionId, {
      status: "paused",
      displayText: "Индексация приостановлена",
    });

    if (!updated) {
      throw new KnowledgeBaseError("Не удалось приостановить индексацию", 500);
    }

    const actionRecord = await storage.getKnowledgeBaseIndexingAction(
      workspaceId,
      baseId,
      action.actionId,
    );
    if (!actionRecord) {
      throw new KnowledgeBaseError("Action не найден после обновления", 500);
    }

    const stats = await storage.getKnowledgeBaseIndexingJobsStatsForAction(
      workspaceId,
      baseId,
      actionRecord.createdAt,
      actionRecord.updatedAt,
    );

    const pendingCount = await storage.countKnowledgeBaseIndexingJobs(
      workspaceId,
      baseId,
      "pending",
      { since: actionRecord.createdAt },
    );

    return {
      success: true,
      actionId: action.actionId,
      status: "paused",
      processedDocuments: stats.processedDocuments,
      pendingDocuments: pendingCount,
      message: "Индексация приостановлена",
    };
  }

  async resume(
    workspaceId: string,
    baseId: string,
    actionId?: string,
  ): Promise<{
    success: boolean;
    actionId: string;
    status: KnowledgeBaseIndexingActionStatus;
    pendingDocuments: number;
    message: string;
  }> {
    const action = actionId
      ? await this.get(workspaceId, baseId, actionId)
      : await this.getLatest(workspaceId, baseId);

    if (!action) {
      throw new KnowledgeBaseError("Нет активной индексации", 400);
    }

    if (action.status !== "paused") {
      throw new KnowledgeBaseError(
        `Индексация не может быть возобновлена. Текущий статус: ${action.status}`,
        400,
      );
    }

    const updated = await this.update(workspaceId, baseId, action.actionId, {
      status: "processing",
      displayText: "Индексация возобновлена",
    });

    if (!updated) {
      throw new KnowledgeBaseError("Не удалось возобновить индексацию", 500);
    }

    const actionRecord = await storage.getKnowledgeBaseIndexingAction(
      workspaceId,
      baseId,
      action.actionId,
    );
    if (!actionRecord) {
      throw new KnowledgeBaseError("Action не найден после обновления", 500);
    }

    const pendingCount = await storage.countKnowledgeBaseIndexingJobs(
      workspaceId,
      baseId,
      "pending",
      { since: actionRecord.createdAt },
    );

    return {
      success: true,
      actionId: action.actionId,
      status: "processing",
      pendingDocuments: pendingCount,
      message: "Индексация возобновлена",
    };
  }
}

export const knowledgeBaseIndexingActionsService = new KnowledgeBaseIndexingActionsService();


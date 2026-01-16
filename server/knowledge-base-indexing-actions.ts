import { randomUUID } from "crypto";
import { storage } from "./storage";
import { KnowledgeBaseError } from "./knowledge-base";
import type {
  KnowledgeBaseIndexingAction,
  KnowledgeBaseIndexingActionRecord,
  KnowledgeBaseIndexingActionInsert,
  IndexingStage,
  KnowledgeBaseIndexingActionStatus,
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
}

export const knowledgeBaseIndexingActionsService = new KnowledgeBaseIndexingActionsService();


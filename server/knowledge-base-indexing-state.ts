import { and, eq, sql } from "drizzle-orm";

import { db } from "./db";
import { storage } from "./storage";
import {
  knowledgeBases,
  knowledgeDocumentIndexState,
  knowledgeDocuments,
  type KnowledgeBaseIndexStatus,
  type KnowledgeDocumentIndexStateInsert,
  type KnowledgeDocumentIndexStatus,
} from "@shared/schema";

type BaseStateCounts = {
  totalDocuments: number;
  outdatedDocuments: number;
  indexingDocuments: number;
  errorDocuments: number;
  upToDateDocuments: number;
};

type DocumentStateUpdate = {
  workspaceId: string;
  baseId: string;
  documentId: string;
  status: KnowledgeDocumentIndexStatus;
  indexedVersionId?: string | null;
  chunkSetId?: string | null;
  error?: string | null;
  indexedAt?: Date | null;
  policyHash?: string | null;
};

type UpdateOptions = {
  recalculateBase?: boolean;
};

const resolveBaseStatus = (counts: BaseStateCounts): KnowledgeBaseIndexStatus => {
  if (counts.totalDocuments === 0) {
    return "not_indexed";
  }

  if (counts.indexingDocuments > 0) {
    return "indexing";
  }

  if (counts.upToDateDocuments === counts.totalDocuments) {
    return "up_to_date";
  }

  if (counts.errorDocuments === counts.totalDocuments) {
    return "error";
  }

  if (counts.outdatedDocuments > 0) {
    return "outdated";
  }

  return "partial";
};

const getPolicyHash = async (): Promise<string | null> => {
  const policy = await storage.getKnowledgeBaseIndexingPolicy();
  return policy?.policyHash ?? null;
};

const resolveDocumentState = async (
  update: DocumentStateUpdate,
): Promise<KnowledgeDocumentIndexStateInsert> => {
  const existing = await storage.getKnowledgeDocumentIndexState(
    update.workspaceId,
    update.baseId,
    update.documentId,
  );
  const policyHash = update.policyHash ?? existing?.policyHash ?? (await getPolicyHash());

  return {
    workspaceId: update.workspaceId,
    baseId: update.baseId,
    documentId: update.documentId,
    indexedVersionId:
      update.indexedVersionId !== undefined ? update.indexedVersionId : existing?.indexedVersionId ?? null,
    chunkSetId: update.chunkSetId !== undefined ? update.chunkSetId : existing?.chunkSetId ?? null,
    policyHash,
    status: update.status,
    error: update.error !== undefined ? update.error : existing?.error ?? null,
    indexedAt:
      update.indexedAt !== undefined ? update.indexedAt : existing?.indexedAt ?? null,
  };
};

const buildBaseCounts = async (
  workspaceId: string,
  baseId: string,
): Promise<BaseStateCounts> => {
  const [{ totalDocuments }] = await db
    .select({
      totalDocuments: sql<number>`count(*)`,
    })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.workspaceId, workspaceId), eq(knowledgeDocuments.baseId, baseId)));

  const rows = await db
    .select({
      status: knowledgeDocumentIndexState.status,
      count: sql<number>`count(*)`,
    })
    .from(knowledgeDocumentIndexState)
    .where(and(eq(knowledgeDocumentIndexState.workspaceId, workspaceId), eq(knowledgeDocumentIndexState.baseId, baseId)))
    .groupBy(knowledgeDocumentIndexState.status);

  const counts: Record<KnowledgeDocumentIndexStatus, number> = {
    not_indexed: 0,
    outdated: 0,
    indexing: 0,
    up_to_date: 0,
    error: 0,
  };

  for (const row of rows) {
    const status = row.status as KnowledgeDocumentIndexStatus;
    if (status && status in counts) {
      counts[status] = Number(row.count ?? 0);
    }
  }

  const accounted =
    counts.not_indexed +
    counts.outdated +
    counts.indexing +
    counts.up_to_date +
    counts.error;
  const missing = Math.max(Number(totalDocuments ?? 0) - accounted, 0);

  return {
    totalDocuments: Number(totalDocuments ?? 0),
    outdatedDocuments: counts.outdated + counts.not_indexed + missing,
    indexingDocuments: counts.indexing,
    errorDocuments: counts.error,
    upToDateDocuments: counts.up_to_date,
  };
};

const getCurrentVersionId = async (
  workspaceId: string,
  baseId: string,
  documentId: string,
): Promise<string | null> => {
  const [row] = await db
    .select({ currentVersionId: knowledgeDocuments.currentVersionId })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, workspaceId),
        eq(knowledgeDocuments.baseId, baseId),
        eq(knowledgeDocuments.id, documentId),
      ),
    )
    .limit(1);

  return row?.currentVersionId ?? null;
};

export class KnowledgeBaseIndexingStateService {
  async recalculateBaseState(workspaceId: string, baseId: string): Promise<void> {
    const counts = await buildBaseCounts(workspaceId, baseId);
    const policyHash = await getPolicyHash();
    const status = resolveBaseStatus(counts);

    await storage.upsertKnowledgeBaseIndexState({
      workspaceId,
      baseId,
      status,
      totalDocuments: counts.totalDocuments,
      outdatedDocuments: counts.outdatedDocuments,
      indexingDocuments: counts.indexingDocuments,
      errorDocuments: counts.errorDocuments,
      upToDateDocuments: counts.upToDateDocuments,
      policyHash,
    });
  }

  async markDocumentNotIndexed(
    workspaceId: string,
    baseId: string,
    documentId: string,
    options: UpdateOptions = {},
  ): Promise<void> {
    const state = await resolveDocumentState({
      workspaceId,
      baseId,
      documentId,
      status: "not_indexed",
      indexedVersionId: null,
      chunkSetId: null,
      error: null,
      indexedAt: null,
    });

    await storage.upsertKnowledgeDocumentIndexState(state);
    if (options.recalculateBase !== false) {
      await this.recalculateBaseState(workspaceId, baseId);
    }
  }

  async markDocumentOutdated(
    workspaceId: string,
    baseId: string,
    documentId: string,
    options: UpdateOptions = {},
  ): Promise<void> {
    const state = await resolveDocumentState({
      workspaceId,
      baseId,
      documentId,
      status: "outdated",
      error: null,
    });

    await storage.upsertKnowledgeDocumentIndexState(state);
    if (options.recalculateBase !== false) {
      await this.recalculateBaseState(workspaceId, baseId);
    }
  }

  async markBaseDocumentsOutdated(
    workspaceId: string,
    baseId: string,
    options: UpdateOptions = {},
  ): Promise<void> {
    const policyHash = await getPolicyHash();
    const now = new Date();

    await db.execute(sql`
      INSERT INTO "knowledge_document_index_state" (
        "workspace_id",
        "base_id",
        "document_id",
        "status",
        "error",
        "policy_hash",
        "created_at",
        "updated_at"
      )
      SELECT
        ${workspaceId},
        ${baseId},
        doc."id",
        'outdated',
        NULL,
        ${policyHash},
        ${now},
        ${now}
      FROM "knowledge_documents" AS doc
      WHERE doc."workspace_id" = ${workspaceId}
        AND doc."base_id" = ${baseId}
      ON CONFLICT ("workspace_id", "base_id", "document_id") DO UPDATE
        SET "status" = 'outdated',
            "error" = NULL,
            "policy_hash" = EXCLUDED."policy_hash",
            "updated_at" = EXCLUDED."updated_at"
    `);

    if (options.recalculateBase !== false) {
      await this.recalculateBaseState(workspaceId, baseId);
    }
  }

  async markDocumentIndexing(
    workspaceId: string,
    baseId: string,
    documentId: string,
    options: UpdateOptions = {},
  ): Promise<void> {
    const state = await resolveDocumentState({
      workspaceId,
      baseId,
      documentId,
      status: "indexing",
      error: null,
    });

    await storage.upsertKnowledgeDocumentIndexState(state);
    if (options.recalculateBase !== false) {
      await this.recalculateBaseState(workspaceId, baseId);
    }
  }

  async markDocumentUpToDate(
    workspaceId: string,
    baseId: string,
    documentId: string,
    indexedVersionId: string,
    chunkSetId: string,
    indexedAt: Date,
    options: UpdateOptions = {},
  ): Promise<void> {
    const currentVersionId = await getCurrentVersionId(workspaceId, baseId, documentId);
    if (currentVersionId && currentVersionId !== indexedVersionId) {
      await this.markDocumentOutdated(workspaceId, baseId, documentId, options);
      return;
    }

    const state = await resolveDocumentState({
      workspaceId,
      baseId,
      documentId,
      status: "up_to_date",
      indexedVersionId,
      chunkSetId,
      indexedAt,
      error: null,
    });

    await storage.upsertKnowledgeDocumentIndexState(state);
    if (options.recalculateBase !== false) {
      await this.recalculateBaseState(workspaceId, baseId);
    }
  }

  async markDocumentError(
    workspaceId: string,
    baseId: string,
    documentId: string,
    error: string,
    indexedVersionId?: string | null,
    options: UpdateOptions = {},
  ): Promise<void> {
    if (indexedVersionId) {
      const currentVersionId = await getCurrentVersionId(workspaceId, baseId, documentId);
      if (currentVersionId && currentVersionId !== indexedVersionId) {
        await this.markDocumentOutdated(workspaceId, baseId, documentId, options);
        return;
      }
    }

    const state = await resolveDocumentState({
      workspaceId,
      baseId,
      documentId,
      status: "error",
      error,
    });

    await storage.upsertKnowledgeDocumentIndexState(state);
    if (options.recalculateBase !== false) {
      await this.recalculateBaseState(workspaceId, baseId);
    }
  }

  async markAllDocumentsOutdatedByPolicy(policyHash?: string | null): Promise<void> {
    const effectivePolicyHash = policyHash ?? (await getPolicyHash());
    const now = new Date();

    await db
      .update(knowledgeDocumentIndexState)
      .set({
        status: "outdated",
        policyHash: effectivePolicyHash,
        error: null,
        updatedAt: now,
      })
      .execute();

    const bases = await db
      .select({
        workspaceId: knowledgeBases.workspaceId,
        baseId: knowledgeBases.id,
      })
      .from(knowledgeBases);

    for (const base of bases) {
      await this.recalculateBaseState(base.workspaceId, base.baseId);
    }
  }
}

export const knowledgeBaseIndexingStateService = new KnowledgeBaseIndexingStateService();

import {
  type KnowledgeBaseSummary,
  type KnowledgeBaseTreeNode,
  type KnowledgeBaseNodeDetail,
  type KnowledgeBaseBreadcrumb,
  type KnowledgeBaseChildNode,
  type UpdateKnowledgeNodeParentRequest,
  type DeleteKnowledgeNodeResponse,
  type CreateKnowledgeBasePayload,
  type DeleteKnowledgeBasePayload,
  type DeleteKnowledgeBaseResponse,
  type CreateKnowledgeFolderPayload,
  type CreateKnowledgeDocumentPayload,
  type CreateKnowledgeFolderResponse,
  type CreateKnowledgeDocumentResponse,
  type UpdateKnowledgeDocumentPayload,
  type UpdateKnowledgeDocumentResponse,
} from "@shared/knowledge-base";
import {
  knowledgeBases,
  knowledgeNodes,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  knowledgeDocumentChunkSets,
  knowledgeBaseNodeTypes,
  knowledgeNodeSourceTypes,
  knowledgeDocumentStatuses,
  type KnowledgeBaseNodeType,
  type KnowledgeNodeSourceType,
  type KnowledgeDocumentStatus,
  workspaces,
} from "@shared/schema";
import { db } from "./db";
import { storage, ensureKnowledgeBaseTables, isKnowledgeBasePathLtreeEnabled } from "./storage";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { load as loadHtml } from "cheerio";
import { getLatestKnowledgeDocumentChunkSetForDocument } from "./knowledge-chunks";
import { adjustWorkspaceObjectCounters } from "./usage/usage-service";
import { getUsagePeriodForDate } from "./usage/usage-types";
import { workspaceOperationGuard } from "./guards/workspace-operation-guard";
import { OperationBlockedError, mapDecisionToPayload } from "./guards/errors";
import { knowledgeBaseIndexingActionsService } from "./knowledge-base-indexing-actions";

export class KnowledgeBaseError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KnowledgeBaseError";
    this.status = status;
  }
}

type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;
type KnowledgeBaseInsert = typeof knowledgeBases.$inferInsert;
type KnowledgeNodeRow = typeof knowledgeNodes.$inferSelect;

const NODE_TYPE_SET = new Set<KnowledgeBaseNodeType>(knowledgeBaseNodeTypes);
const NODE_SOURCE_SET = new Set<KnowledgeNodeSourceType>(knowledgeNodeSourceTypes);
const DOCUMENT_STATUS_SET = new Set<KnowledgeDocumentStatus>(knowledgeDocumentStatuses);

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function transliterate(value: string): string {
  let result = "";

  for (const char of value) {
    const lower = char.toLowerCase();
    const mapped = CYRILLIC_TO_LATIN[lower];
    if (mapped !== undefined) {
      result += mapped;
    } else {
      result += char;
    }
  }

  return result;
}

function normalizeForSlug(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const transliterated = transliterate(trimmed);
  return transliterated
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9\s-]+/g, " ");
}

function generateBaseSlug(title: string, fallback: string): string {
  const normalized = normalizeForSlug(title);
  const collapsed = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 190);

  return collapsed || fallback;
}

function ensureUniqueSlug(
  existing: Set<string>,
  desired: string,
  fallback: string,
): string {
  const base = desired || fallback;
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }

  let index = 2;
  while (index < 1_000) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) {
      existing.add(candidate);
      return candidate;
    }
    index += 1;
  }

  const randomSuffix = randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();
  const finalCandidate = `${fallback}-${randomSuffix}`;
  existing.add(finalCandidate);
  return finalCandidate;
}

function buildSegmentFallback(nodeId: string): string {
  const sanitized = nodeId.replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase();
  return sanitized ? `node_${sanitized}` : `node_${randomUUID().slice(0, 8).toLowerCase()}`;
}

function slugToLtreeSegment(slug: string, fallback: string): string {
  const sanitized = slug
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  let segment = sanitized || fallback;
  if (!/^[a-z]/.test(segment)) {
    segment = `n_${segment}`;
  }
  if (segment.length > 255) {
    segment = segment.slice(0, 255);
  }
  return segment;
}

function buildNodePath(parentPath: string | null, segment: string): string {
  return parentPath && parentPath.length > 0 ? `${parentPath}.${segment}` : segment;
}

function countWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/u).length;
}

function computeContentHash(content: string): string | null {
  if (!content.trim()) {
    return null;
  }

  return createHash("sha256").update(content, "utf8").digest("hex");
}

function extractPlainTextFromHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const $ = loadHtml(trimmed);
    const text = $("body").text() || $.root().text();
    return text.replace(/\s+/g, " ").trim();
  } catch {
    return trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function getNextPosition(nodes: KnowledgeNodeRow[], parentId: string | null): number {
  let maxPosition = -1;

  for (const node of nodes) {
    const nodeParentId = node.parentId ?? null;
    if (nodeParentId === parentId && node.position > maxPosition) {
      maxPosition = node.position;
    }
  }

  return maxPosition + 1;
}

function getDatabaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : null;
}

function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function groupNodesByParent(nodes: KnowledgeNodeRow[]): Map<string | null, KnowledgeNodeRow[]> {
  const groups = new Map<string | null, KnowledgeNodeRow[]>();

  for (const node of nodes) {
    const key = node.parentId ?? null;
    const collection = groups.get(key);
    if (collection) {
      collection.push(node);
    } else {
      groups.set(key, [node]);
    }
  }

  for (const collection of groups.values()) {
    collection.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.title.localeCompare(b.title, "ru");
    });
  }

  return groups;
}

function buildTreeFromGroups(
  groups: Map<string | null, KnowledgeNodeRow[]>,
  parentId: string | null,
): KnowledgeBaseTreeNode[] {
  const children = groups.get(parentId) ?? [];

  return children.map((child) => ({
    id: child.id,
    title: child.title,
    type: NODE_TYPE_SET.has(child.type) ? child.type : "document",
    sourceType: child.type === "document" ? resolveNodeSourceType(child) : undefined,
    children: buildTreeFromGroups(groups, child.id),
  }));
}

function buildStructure(nodes: KnowledgeNodeRow[]): KnowledgeBaseTreeNode[] {
  const groups = groupNodesByParent(nodes);
  return buildTreeFromGroups(groups, null);
}

function buildBreadcrumbs(
  base: KnowledgeBaseRow,
  node: KnowledgeNodeRow,
  nodesById: Map<string, KnowledgeNodeRow>,
): KnowledgeBaseBreadcrumb[] {
  const breadcrumbs: KnowledgeBaseBreadcrumb[] = [
    { id: base.id, title: base.name, type: "base" },
  ];

  const chain: KnowledgeBaseBreadcrumb[] = [];
  let currentParentId = node.parentId;

  while (currentParentId) {
    const parent = nodesById.get(currentParentId);
    if (!parent) {
      break;
    }

    chain.unshift({ id: parent.id, title: parent.title, type: "folder" });
    currentParentId = parent.parentId;
  }

  breadcrumbs.push(...chain);

  if (node.type === "folder") {
    breadcrumbs.push({ id: node.id, title: node.title, type: "folder" });
  }

  return breadcrumbs;
}

function mapChildren(
  node: KnowledgeNodeRow,
  groups: Map<string | null, KnowledgeNodeRow[]>,
  nodesById: Map<string, KnowledgeNodeRow>,
): KnowledgeBaseChildNode[] {
  const children = groups.get(node.id) ?? [];

  return children.map((child) => ({
    id: child.id,
    title: child.title,
    type: NODE_TYPE_SET.has(child.type) ? child.type : "document",
    parentId: child.parentId ?? null,
    childCount: groups.get(child.id)?.length ?? 0,
    updatedAt: toIsoDate(child.updatedAt),
    sourceType: child.type === "document" ? resolveNodeSourceType(child) : undefined,
    importFileName: child.type === "document" ? child.importFileName ?? null : undefined,
  }));
}

function collectDescendants(
  groups: Map<string | null, KnowledgeNodeRow[]>,
  nodeId: string,
  acc: Set<string>,
): Set<string> {
  const children = groups.get(nodeId) ?? [];

  for (const child of children) {
    if (!acc.has(child.id)) {
      acc.add(child.id);
      collectDescendants(groups, child.id, acc);
    }
  }

  return acc;
}

function resolveNodeSourceType(node: KnowledgeNodeRow): KnowledgeNodeSourceType {
  const raw = (node.sourceType ?? "manual") as KnowledgeNodeSourceType;
  return NODE_SOURCE_SET.has(raw) ? raw : "manual";
}

async function fetchWorkspaceBases(workspaceId: string): Promise<KnowledgeBaseRow[]> {
  await ensureKnowledgeBaseTables();

  return await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.workspaceId, workspaceId))
    .orderBy(desc(knowledgeBases.updatedAt), asc(knowledgeBases.name));
}

async function createDefaultBase(workspaceId: string): Promise<void> {
  await ensureKnowledgeBaseTables();

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const baseName = workspace?.name ? `База знаний «${workspace.name}»` : "База знаний";
  const description =
    "Добавьте документы или импортируйте архив, чтобы пополнить базу знаний.";

  await db.insert(knowledgeBases).values({
    workspaceId,
    name: baseName,
    description,
  });
}

async function fetchBase(baseId: string, workspaceId: string): Promise<KnowledgeBaseRow | null> {
  await ensureKnowledgeBaseTables();

  const [base] = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, baseId), eq(knowledgeBases.workspaceId, workspaceId)))
    .limit(1);

  return base ?? null;
}

async function fetchBaseNodes(baseId: string): Promise<KnowledgeNodeRow[]> {
  await ensureKnowledgeBaseTables();

  return await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.baseId, baseId))
    .orderBy(asc(knowledgeNodes.position), asc(knowledgeNodes.createdAt));
}

async function fetchDocumentIdsByNodeIds(
  baseId: string,
  workspaceId: string,
  nodeIds: readonly string[],
): Promise<string[]> {
  if (!nodeIds || nodeIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.baseId, baseId),
        eq(knowledgeDocuments.workspaceId, workspaceId),
        inArray(knowledgeDocuments.nodeId, nodeIds as string[]),
      ),
    );

  return rows.map((row: (typeof rows)[number]) => row.id);
}

async function fetchDocumentIdsByBase(
  baseId: string,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.baseId, baseId), eq(knowledgeDocuments.workspaceId, workspaceId)));

  return rows.map((row: (typeof rows)[number]) => row.id);
}

async function deleteDocumentsWithChunks(
  tx: typeof db,
  documentIds: readonly string[],
  workspaceId: string,
): Promise<void> {
  if (!documentIds || documentIds.length === 0) {
    return;
  }

  await tx
    .delete(knowledgeDocumentChunkSets)
    .where(
      and(
        eq(knowledgeDocumentChunkSets.workspaceId, workspaceId),
        inArray(knowledgeDocumentChunkSets.documentId, documentIds as string[]),
      ),
    );

  await tx
    .delete(knowledgeDocumentVersions)
    .where(
      and(
        eq(knowledgeDocumentVersions.workspaceId, workspaceId),
        inArray(knowledgeDocumentVersions.documentId, documentIds as string[]),
      ),
    );

  await tx
    .delete(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.workspaceId, workspaceId),
        inArray(knowledgeDocuments.id, documentIds as string[]),
      ),
    );
}

export async function createKnowledgeBase(
  workspaceId: string,
  payload: CreateKnowledgeBasePayload,
): Promise<KnowledgeBaseSummary> {
  await ensureKnowledgeBaseTables();

  const decision = await workspaceOperationGuard.check({
    workspaceId,
    operationType: "CREATE_KNOWLEDGE_BASE",
    expectedCost: { objects: 1 },
    meta: { objects: { entityType: "knowledge_base" } },
  });
  if (!decision.allowed) {
    throw new OperationBlockedError(
      mapDecisionToPayload(decision, {
        workspaceId,
        operationType: "CREATE_KNOWLEDGE_BASE",
        meta: { objects: { entityType: "knowledge_base" } },
      }),
    );
  }

  const name = payload.name?.trim();
  if (!name) {
    throw new KnowledgeBaseError("Укажите название базы знаний", 400);
  }

  const description = payload.description?.trim() ?? "";
  const insertValues: KnowledgeBaseInsert = {
    workspaceId,
    name,
    description,
  };

  if (payload.id) {
    insertValues.id = payload.id;
  }

  try {
    const [created] = await db.insert(knowledgeBases).values(insertValues).returning();
    if (!created) {
      throw new KnowledgeBaseError("Не удалось создать базу знаний", 500);
    }

    const period = getUsagePeriodForDate(created.createdAt ? new Date(created.createdAt) : new Date());
    await adjustWorkspaceObjectCounters(workspaceId, { knowledgeBasesDelta: 1 }, period);

    return {
      id: created.id,
      name: created.name,
      description: created.description,
      updatedAt: toIsoDate(created.updatedAt),
      rootNodes: [],
    } satisfies KnowledgeBaseSummary;
  } catch (error) {
    const code = getDatabaseErrorCode(error);
    if (code === "23505") {
      throw new KnowledgeBaseError(
        "База знаний с таким идентификатором уже существует",
        409,
      );
    }

    if (code === "23503") {
      throw new KnowledgeBaseError(
        "Рабочее пространство не найдено или недоступно для создания базы знаний",
        404,
      );
    }

    throw error;
  }
}

export async function deleteKnowledgeBase(
  workspaceId: string,
  baseId: string,
  payload: DeleteKnowledgeBasePayload,
): Promise<DeleteKnowledgeBaseResponse> {
  await ensureKnowledgeBaseTables();

  const confirmation = payload.confirmation?.trim();
  if (!confirmation) {
    throw new KnowledgeBaseError(
      "Введите название базы знаний для подтверждения удаления",
      400,
    );
  }

  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  if (confirmation !== base.name) {
    throw new KnowledgeBaseError(
      "Название не совпадает с удаляемой базой знаний",
      400,
    );
  }

  const documentIds = await fetchDocumentIdsByBase(baseId, workspaceId);

  await db.transaction(async (tx: typeof db) => {
    if (documentIds.length > 0) {
      await deleteDocumentsWithChunks(tx, documentIds, workspaceId);
    }

    await tx
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, baseId), eq(knowledgeBases.workspaceId, workspaceId)));
  });

  const period = getUsagePeriodForDate(new Date());
  await adjustWorkspaceObjectCounters(workspaceId, { knowledgeBasesDelta: -1 }, period);

  return { deletedId: baseId } satisfies DeleteKnowledgeBaseResponse;
}

export async function listKnowledgeBases(workspaceId: string): Promise<KnowledgeBaseSummary[]> {
  let bases = await fetchWorkspaceBases(workspaceId);

  if (bases.length === 0) {
    await createDefaultBase(workspaceId);
    bases = await fetchWorkspaceBases(workspaceId);
  }

  if (bases.length === 0) {
    return [];
  }

  const baseIds = bases.map((base) => base.id);
  const nodes = baseIds.length
    ? await db
        .select()
        .from(knowledgeNodes)
        .where(inArray(knowledgeNodes.baseId, baseIds))
        .orderBy(
          asc(knowledgeNodes.baseId),
          asc(knowledgeNodes.parentId),
          asc(knowledgeNodes.position),
          asc(knowledgeNodes.createdAt),
        )
    : [];

  const nodesByBase = new Map<string, KnowledgeNodeRow[]>();
  for (const node of nodes) {
    const collection = nodesByBase.get(node.baseId);
    if (collection) {
      collection.push(node);
    } else {
      nodesByBase.set(node.baseId, [node]);
    }
  }

  return bases.map((base) => {
    const baseNodes = nodesByBase.get(base.id) ?? [];

    return {
      id: base.id,
      name: base.name,
      description: base.description,
      updatedAt: toIsoDate(base.updatedAt),
      rootNodes: buildStructure(baseNodes),
    } satisfies KnowledgeBaseSummary;
  });
}

export async function getKnowledgeBaseById(workspaceId: string, baseId: string): Promise<KnowledgeBaseRow | null> {
  await ensureKnowledgeBaseTables();
  return await fetchBase(baseId, workspaceId);
}

export async function startKnowledgeBaseIndexing(baseId: string, workspaceId: string): Promise<{ jobCount: number }> {
  try {
    await ensureKnowledgeBaseTables();
  } catch (error) {
    console.error("Failed to ensure knowledge base tables:", error);
    throw new KnowledgeBaseError("Не удалось инициализировать таблицы баз знаний", 500);
  }
  
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  let documentIds: string[];
  try {
    documentIds = await fetchDocumentIdsByBase(baseId, workspaceId);
  } catch (error) {
    console.error("Failed to fetch document IDs:", error);
    throw new KnowledgeBaseError("Не удалось получить список документов", 500);
  }

  if (documentIds.length === 0) {
    return { jobCount: 0, actionId: undefined };
  }

  // Создаем action для отслеживания статуса индексации
  let actionId: string | undefined;
  try {
    actionId = randomUUID();
    await knowledgeBaseIndexingActionsService.start(workspaceId, baseId, actionId, "initializing");
    await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, actionId, {
      stage: "initializing",
      displayText: `Инициализация индексации ${documentIds.length} документов...`,
      payload: {
        totalDocuments: documentIds.length,
        processedDocuments: 0,
        progressPercent: 0,
      },
    });
  } catch (error) {
    console.error(`[startKnowledgeBaseIndexing] Failed to create indexing action for baseId: ${baseId}, workspaceId: ${workspaceId}`, error);
    // Продолжаем без action, индексация все равно должна работать
    actionId = undefined;
  }

  // Получаем документы с их версиями и nodeId
  let documents: Array<{ documentId: string; nodeId: string; versionId: string | null }>;
  try {
    documents = await db
      .select({
        documentId: knowledgeDocuments.id,
        nodeId: knowledgeDocuments.nodeId,
        versionId: knowledgeDocuments.currentVersionId,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.baseId, baseId),
          eq(knowledgeDocuments.workspaceId, workspaceId),
          inArray(knowledgeDocuments.id, documentIds),
        ),
      );
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    throw new KnowledgeBaseError("Не удалось получить документы для индексации", 500);
  }

  let jobCount = 0;
  let documentsWithoutVersions = 0;

  for (const doc of documents) {
    let effectiveVersionId = doc.versionId;

    // Если у документа нет версии, создаем начальную версию
    if (!effectiveVersionId) {
      try {
        // Получаем данные узла для создания версии
        const [node] = await db
          .select({
            id: knowledgeNodes.id,
            title: knowledgeNodes.title,
            content: knowledgeNodes.content,
          })
          .from(knowledgeNodes)
          .where(
            and(
              eq(knowledgeNodes.id, doc.nodeId),
              eq(knowledgeNodes.baseId, baseId),
            ),
          )
          .limit(1);

        if (!node) {
          console.warn(`Node not found for document ${doc.documentId}, nodeId: ${doc.nodeId}`);
          documentsWithoutVersions++;
          continue;
        }

        // Создаем начальную версию
        const versionId = randomUUID();
        const contentHtml = node.content ?? "";
        const contentPlainText = extractPlainTextFromHtml(contentHtml) || "";
        const contentMarkdown = "";
        const hash = computeContentHash(contentMarkdown || contentPlainText || contentHtml);
        const wordCount = countWords(contentPlainText);

        const [version] = await db
          .insert(knowledgeDocumentVersions)
          .values({
            id: versionId,
            documentId: doc.documentId,
            workspaceId,
            versionNo: 1,
            contentJson: {
              html: contentHtml,
              markdown: contentMarkdown || undefined,
            },
            contentText: contentPlainText,
            hash: hash ?? null,
            wordCount,
          })
          .returning();

        if (!version) {
          console.warn(`Failed to create version for document ${doc.documentId}`);
          documentsWithoutVersions++;
          continue;
        }

        // Обновляем currentVersionId в документе
        await db
          .update(knowledgeDocuments)
          .set({
            currentVersionId: version.id,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeDocuments.id, doc.documentId));

        effectiveVersionId = version.id;
        console.log(`Created initial version for document ${doc.documentId}, versionId: ${effectiveVersionId}`);
      } catch (error) {
        console.error(`Failed to create version for document ${doc.documentId}:`, error);
        documentsWithoutVersions++;
        continue;
      }
    }

    // Создаем job для индексации
    try {
      const job = await storage.createKnowledgeBaseIndexingJob({
        jobType: "knowledge_base_indexing",
        workspaceId,
        baseId,
        documentId: doc.documentId,
        versionId: effectiveVersionId,
        status: "pending",
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        chunkCount: null,
        totalChars: null,
        totalTokens: null,
      });

      if (job) {
        jobCount++;
      }
    } catch (error) {
      console.error(`Failed to create indexing job for document ${doc.documentId}:`, error);
      // Продолжаем обработку других документов, но логируем ошибку
    }
  }

  if (documentsWithoutVersions > 0) {
    console.warn(
      `Skipped ${documentsWithoutVersions} document(s) without versions that could not be fixed automatically`,
    );
  }

  // Обновляем статус после создания всех job'ов
  if (actionId) {
    try {
      if (jobCount > 0) {
        await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, actionId, {
          stage: "initializing",
          displayText: `Запущена индексация ${jobCount} документов. Процесс выполняется в фоновом режиме.`,
          payload: {
            totalDocuments: jobCount,
            processedDocuments: 0,
            progressPercent: 0,
          },
        });
      } else {
        // Если job'ов нет, завершаем action
        await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, actionId, {
          status: "done",
          stage: "completed",
          displayText: "Нет документов для индексации",
        });
      }
    } catch (error) {
      console.error(`[startKnowledgeBaseIndexing] Failed to update indexing action for baseId: ${baseId}, workspaceId: ${workspaceId}, actionId: ${actionId}`, error);
      // Продолжаем, ошибка обновления статуса не критична
    }
  }

  return { jobCount, actionId };
}

export async function getKnowledgeNodeDetail(
  baseId: string,
  nodeId: string,
  workspaceId: string,
): Promise<KnowledgeBaseNodeDetail> {
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  const nodes = await fetchBaseNodes(baseId);
  const groups = groupNodesByParent(nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  if (!nodeId || nodeId === "root") {
    return {
      type: "base",
      id: base.id,
      name: base.name,
      description: base.description,
      updatedAt: toIsoDate(base.updatedAt),
      rootNodes: buildTreeFromGroups(groups, null),
    } satisfies KnowledgeBaseNodeDetail;
  }

  const node = nodesById.get(nodeId);
  if (!node) {
    throw new KnowledgeBaseError("Элемент не найден", 404);
  }

  if (node.type === "folder") {
    return {
      type: "folder",
      id: node.id,
      title: node.title,
      updatedAt: toIsoDate(node.updatedAt),
      breadcrumbs: buildBreadcrumbs(base, node, nodesById),
      children: mapChildren(node, groups, nodesById),
      structure: buildTreeFromGroups(groups, null),
    } satisfies KnowledgeBaseNodeDetail;
  }

  const [documentRow] = await db
    .select({
      documentId: knowledgeDocuments.id,
      status: knowledgeDocuments.status,
      sourceUrl: knowledgeDocuments.sourceUrl,
      versionId: knowledgeDocumentVersions.id,
      versionNo: knowledgeDocumentVersions.versionNo,
      contentJson: knowledgeDocumentVersions.contentJson,
      contentText: knowledgeDocumentVersions.contentText,
      versionCreatedAt: knowledgeDocumentVersions.createdAt,
    })
    .from(knowledgeDocuments)
    .leftJoin(
      knowledgeDocumentVersions,
      eq(knowledgeDocuments.currentVersionId, knowledgeDocumentVersions.id),
    )
    .where(and(eq(knowledgeDocuments.nodeId, node.id), eq(knowledgeDocuments.workspaceId, workspaceId)))
    .limit(1);

  const rawStatus = (documentRow?.status ?? "draft") as KnowledgeDocumentStatus;
  const status = DOCUMENT_STATUS_SET.has(rawStatus) ? rawStatus : "draft";
  const documentId = documentRow?.documentId ?? node.id;
  const versionId = documentRow?.versionId ?? null;
  const versionNumber = documentRow?.versionNo ?? null;
  const versionCreatedAt = documentRow?.versionCreatedAt ?? node.updatedAt;
  const versionContent = (documentRow?.contentJson ?? {}) as Record<string, unknown>;
  const contentHtml =
    typeof versionContent.html === "string" ? versionContent.html : "";
  const contentMarkdown =
    typeof versionContent.markdown === "string" ? versionContent.markdown : null;
  const contentPlainText = documentRow?.contentText ?? "";

  const chunkSet = await getLatestKnowledgeDocumentChunkSetForDocument(documentId, workspaceId).catch((error) => {
    if (error instanceof KnowledgeBaseError && error.status === 404) {
      return null;
    }

    throw error;
  });

  return {
    type: "document",
    id: node.id,
    title: node.title,
    content: contentHtml || contentPlainText,
    contentMarkdown,
    contentPlainText,
    sourceUrl: documentRow?.sourceUrl ?? null,
    updatedAt: toIsoDate(versionCreatedAt),
    breadcrumbs: buildBreadcrumbs(base, node, nodesById),
    sourceType: resolveNodeSourceType(node),
    importFileName: node.importFileName ?? null,
    documentId,
    status,
    versionId,
    versionNumber,
    children: mapChildren(node, groups, nodesById),
    structure: buildTreeFromGroups(groups, null),
    chunkSet,
  } satisfies KnowledgeBaseNodeDetail;
}

export async function createKnowledgeFolder(
  baseId: string,
  workspaceId: string,
  payload: CreateKnowledgeFolderPayload,
): Promise<CreateKnowledgeFolderResponse> {
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  const title = payload.title?.trim();
  if (!title) {
    throw new KnowledgeBaseError("Укажите название подраздела", 400);
  }

  const nodes = await fetchBaseNodes(baseId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentId = payload.parentId && payload.parentId.trim() ? payload.parentId.trim() : null;

  if (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) {
      throw new KnowledgeBaseError("Родительский раздел не найден", 404);
    }

    if (parent.type !== "folder") {
      throw new KnowledgeBaseError("Родителем может быть только подраздел", 400);
    }
  }

  const position = getNextPosition(nodes, parentId);

  const nodeId = randomUUID();
  const existingSlugs = new Set(nodes.map((node) => node.slug));
  const fallbackSlug = `folder-${nodeId.slice(0, 6).toLowerCase()}`;
  const desiredSlug = generateBaseSlug(title, fallbackSlug);
  const slug = ensureUniqueSlug(existingSlugs, desiredSlug, fallbackSlug);
  const segmentFallback = buildSegmentFallback(nodeId);
  const parentPath = parentId ? nodesById.get(parentId)?.path ?? null : null;
  const pathSegment = slugToLtreeSegment(slug, segmentFallback);
  const path = buildNodePath(parentPath, pathSegment);

  let createdNode: KnowledgeNodeRow | null = null;

  await db.transaction(async (tx: typeof db) => {
    const [created] = await tx
      .insert(knowledgeNodes)
      .values({
        id: nodeId,
        baseId,
        workspaceId,
        parentId,
        title,
        type: "folder",
        position,
        slug,
        path,
      })
      .returning();

    if (!created) {
      throw new KnowledgeBaseError("Не удалось создать подраздел", 500);
    }

    createdNode = created;

    const timestamp = new Date();

    if (parentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: timestamp })
        .where(and(eq(knowledgeNodes.id, parentId), eq(knowledgeNodes.baseId, baseId)));
    }

    await tx
      .update(knowledgeBases)
      .set({ updatedAt: timestamp })
      .where(eq(knowledgeBases.id, baseId));
  });

  if (!createdNode) {
    throw new KnowledgeBaseError("Не удалось создать подраздел", 500);
  }

  const node = createdNode as KnowledgeNodeRow;

  return {
    id: node.id,
    title: node.title,
    parentId: node.parentId ?? null,
    type: "folder",
    updatedAt: toIsoDate(node.updatedAt),
  } satisfies CreateKnowledgeFolderResponse;
}

export async function createKnowledgeDocument(
  baseId: string,
  workspaceId: string,
  payload: CreateKnowledgeDocumentPayload,
): Promise<CreateKnowledgeDocumentResponse> {
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  const title = payload.title?.trim();
  if (!title) {
    throw new KnowledgeBaseError("Укажите название документа", 400);
  }

  const rawContent = typeof payload.content === "string" ? payload.content : "";
  const rawMarkdown =
    typeof payload.contentMarkdown === "string" ? payload.contentMarkdown : "";
  const rawPlainText =
    typeof payload.contentPlainText === "string" ? payload.contentPlainText : "";
  const contentHtml = rawContent;
  const contentMarkdown = rawMarkdown;
  const contentPlainText = rawPlainText.trim()
    ? rawPlainText.trim()
    : extractPlainTextFromHtml(contentHtml) || rawMarkdown.trim();
  const sourceType =
    payload.sourceType && NODE_SOURCE_SET.has(payload.sourceType) ? payload.sourceType : "manual";
  const importFileName = payload.importFileName?.trim() ? payload.importFileName.trim() : null;

  const nodes = await fetchBaseNodes(baseId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentId = payload.parentId && payload.parentId.trim() ? payload.parentId.trim() : null;

  if (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) {
      throw new KnowledgeBaseError("Родительский элемент не найден", 404);
    }
  }

  const position = getNextPosition(nodes, parentId);

  const nodeId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();

  const existingSlugs = new Set(nodes.map((node) => node.slug));
  const fallbackSlug = `doc-${nodeId.slice(0, 6).toLowerCase()}`;
  const desiredSlug = generateBaseSlug(title, fallbackSlug);
  const slug = ensureUniqueSlug(existingSlugs, desiredSlug, fallbackSlug);
  const segmentFallback = buildSegmentFallback(nodeId);
  const parentPath = parentId ? nodesById.get(parentId)?.path ?? null : null;
  const pathSegment = slugToLtreeSegment(slug, segmentFallback);
  const path = buildNodePath(parentPath, pathSegment);

  const wordCount = countWords(contentPlainText);
  const hash = computeContentHash(contentMarkdown || contentPlainText || contentHtml);

  let createdNode: KnowledgeNodeRow | null = null;
  let createdVersionTimestamp: Date | null = null;
  let createdVersionNumber: number | null = null;

  await db.transaction(async (tx: typeof db) => {
    const [created] = await tx
      .insert(knowledgeNodes)
      .values({
        id: nodeId,
        baseId,
        workspaceId,
        parentId,
        title,
        type: "document",
        position,
        content: null,
        sourceType,
        importFileName,
        slug,
        path,
      })
      .returning();

    if (!created) {
      throw new KnowledgeBaseError("Не удалось создать документ", 500);
    }

    createdNode = created;

    const [document] = await tx
      .insert(knowledgeDocuments)
      .values({
        id: documentId,
        baseId,
        workspaceId,
        nodeId,
        status: "draft" as KnowledgeDocumentStatus,
      })
      .returning();

    if (!document) {
      throw new KnowledgeBaseError("Не удалось зарегистрировать документ", 500);
    }

    const [version] = await tx
      .insert(knowledgeDocumentVersions)
      .values({
        id: versionId,
        documentId: document.id,
        workspaceId,
        versionNo: 1,
        contentJson: {
          html: contentHtml,
          markdown: contentMarkdown || undefined,
        },
        contentText: contentPlainText,
        hash: hash ?? null,
        wordCount,
      })
      .returning();

    if (!version) {
      throw new KnowledgeBaseError("Не удалось сохранить версию документа", 500);
    }

    createdVersionTimestamp = version.createdAt ?? new Date();
    createdVersionNumber = version.versionNo ?? 1;

    await tx
      .update(knowledgeDocuments)
      .set({
        currentVersionId: version.id,
        updatedAt: createdVersionTimestamp,
      })
      .where(and(eq(knowledgeDocuments.id, document.id), eq(knowledgeDocuments.baseId, baseId)));

    await tx
      .update(knowledgeNodes)
      .set({ updatedAt: createdVersionTimestamp })
      .where(and(eq(knowledgeNodes.id, nodeId), eq(knowledgeNodes.baseId, baseId)));

    const timestamp = createdVersionTimestamp;

    if (parentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: timestamp })
        .where(and(eq(knowledgeNodes.id, parentId), eq(knowledgeNodes.baseId, baseId)));
    }

    await tx
      .update(knowledgeBases)
      .set({ updatedAt: timestamp })
      .where(eq(knowledgeBases.id, baseId));
  });

  if (!createdNode) {
    throw new KnowledgeBaseError("Не удалось создать документ", 500);
  }

  const node = createdNode as KnowledgeNodeRow;
  const updatedAt = createdVersionTimestamp ?? node.updatedAt;

  const updatedNodes = [...nodes, node];
  const groups = groupNodesByParent(updatedNodes);
  const updatedNodesById = new Map(updatedNodes.map((entry) => [entry.id, entry]));
  const children = mapChildren(node, groups, updatedNodesById);
  const structure = buildTreeFromGroups(groups, null);

  return {
    id: node.id,
    title: node.title,
    parentId: node.parentId ?? null,
    type: "document",
    content: contentHtml,
    contentMarkdown: contentMarkdown || null,
    contentPlainText: contentPlainText || null,
    updatedAt: toIsoDate(updatedAt),
    sourceType: resolveNodeSourceType(node),
    importFileName: node.importFileName ?? null,
    documentId,
    status: "draft",
    versionId,
    versionNumber: createdVersionNumber,
    children,
    structure,
  } satisfies CreateKnowledgeDocumentResponse;
}

export async function updateKnowledgeDocument(
  baseId: string,
  nodeId: string,
  workspaceId: string,
  payload: UpdateKnowledgeDocumentPayload,
  authorId?: string | null,
): Promise<UpdateKnowledgeDocumentResponse> {
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  const nodes = await fetchBaseNodes(baseId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const node = nodesById.get(nodeId);

  if (!node) {
    throw new KnowledgeBaseError("Документ не найден", 404);
  }

  if (node.type !== "document") {
    throw new KnowledgeBaseError("Редактировать можно только документ", 400);
  }

  const title = payload.title?.trim();
  if (!title) {
    throw new KnowledgeBaseError("Укажите название документа", 400);
  }

  const rawContent = typeof payload.content === "string" ? payload.content : "";
  const rawMarkdown =
    typeof payload.contentMarkdown === "string" ? payload.contentMarkdown : "";
  const rawPlainText =
    typeof payload.contentPlainText === "string" ? payload.contentPlainText : "";
  const contentHtml = rawContent;
  const contentMarkdown = rawMarkdown;
  const contentPlainText = rawPlainText.trim()
    ? rawPlainText.trim()
    : extractPlainTextFromHtml(contentHtml) || rawMarkdown.trim();

  const [documentRow] = await db
    .select({
      id: knowledgeDocuments.id,
      status: knowledgeDocuments.status,
      versionNo: knowledgeDocumentVersions.versionNo,
    })
    .from(knowledgeDocuments)
    .leftJoin(
      knowledgeDocumentVersions,
      eq(knowledgeDocuments.currentVersionId, knowledgeDocumentVersions.id),
    )
    .where(and(eq(knowledgeDocuments.nodeId, node.id), eq(knowledgeDocuments.workspaceId, workspaceId)))
    .limit(1);

  if (!documentRow?.id) {
    throw new KnowledgeBaseError("Документ не найден", 404);
  }

  const documentId = documentRow.id;
  const previousVersionNumber = documentRow.versionNo ?? 0;
  const versionNumber = previousVersionNumber + 1;
  const versionId = randomUUID();

  const wordCount = countWords(contentPlainText);
  const hash = computeContentHash(contentMarkdown || contentPlainText || contentHtml);

  let versionCreatedAt: Date = new Date();

  await db.transaction(async (tx: typeof db) => {
    const [version] = await tx
      .insert(knowledgeDocumentVersions)
      .values({
        id: versionId,
        documentId,
        workspaceId,
        versionNo: versionNumber,
        authorId: authorId ?? null,
        contentJson: {
          html: contentHtml,
          markdown: contentMarkdown || undefined,
        },
        contentText: contentPlainText,
        hash: hash ?? null,
        wordCount,
      })
      .returning();

    versionCreatedAt = version?.createdAt ?? new Date();

    await tx
      .update(knowledgeDocuments)
      .set({
        currentVersionId: versionId,
        updatedAt: versionCreatedAt,
      })
      .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.baseId, baseId)));

    await tx
      .update(knowledgeNodes)
      .set({ title, updatedAt: versionCreatedAt })
      .where(and(eq(knowledgeNodes.id, node.id), eq(knowledgeNodes.baseId, baseId)));

    if (node.parentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: versionCreatedAt })
        .where(and(eq(knowledgeNodes.id, node.parentId), eq(knowledgeNodes.baseId, baseId)));
    }

    await tx
      .update(knowledgeBases)
      .set({ updatedAt: versionCreatedAt })
      .where(eq(knowledgeBases.id, baseId));
  });

  return (await getKnowledgeNodeDetail(baseId, nodeId, workspaceId)) as UpdateKnowledgeDocumentResponse;
}

export async function deleteKnowledgeNode(
  baseId: string,
  nodeId: string,
  workspaceId: string,
): Promise<DeleteKnowledgeNodeResponse> {
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  const nodes = await fetchBaseNodes(baseId);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new KnowledgeBaseError("Элемент не найден", 404);
  }

  const groups = groupNodesByParent(nodes);
  const toDeleteSet = collectDescendants(groups, nodeId, new Set<string>());
  toDeleteSet.add(nodeId);
  const toDelete = Array.from(toDeleteSet);

  const documentIds = await fetchDocumentIdsByNodeIds(baseId, workspaceId, toDelete);

  await db.transaction(async (tx: typeof db) => {
    if (documentIds.length > 0) {
      await deleteDocumentsWithChunks(tx, documentIds, workspaceId);
    }

    await tx.delete(knowledgeNodes).where(inArray(knowledgeNodes.id, toDelete));

    if (node.parentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: new Date() })
        .where(and(eq(knowledgeNodes.id, node.parentId), eq(knowledgeNodes.baseId, baseId)));
    }

    await tx
      .update(knowledgeBases)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeBases.id, baseId));
  });

  return { deletedIds: toDelete } satisfies DeleteKnowledgeNodeResponse;
}

export async function updateKnowledgeNodeParent(
  baseId: string,
  nodeId: string,
  payload: UpdateKnowledgeNodeParentRequest,
  workspaceId: string,
): Promise<void> {
  const base = await fetchBase(baseId, workspaceId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }

  const nodes = await fetchBaseNodes(baseId);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const node = nodesById.get(nodeId);

  if (!node) {
    throw new KnowledgeBaseError("Элемент не найден", 404);
  }

  const newParentId = payload.parentId ?? null;
  if (newParentId === node.parentId) {
    return;
  }

  const groups = groupNodesByParent(nodes);

  if (newParentId) {
    const parent = nodesById.get(newParentId);
    if (!parent) {
      throw new KnowledgeBaseError("Родительский элемент не найден", 404);
    }

    if (node.type === "folder" && parent.type !== "folder") {
      throw new KnowledgeBaseError("Папка может находиться только внутри другой папки", 400);
    }

    const descendantIds = collectDescendants(groups, node.id, new Set<string>());
    if (descendantIds.has(newParentId) || newParentId === node.id) {
      throw new KnowledgeBaseError("Нельзя перенести элемент внутрь самого себя или его потомков", 400);
    }
  }

  const supportsLtree = isKnowledgeBasePathLtreeEnabled();
  const parentPath = newParentId ? nodesById.get(newParentId)?.path ?? null : null;
  const segmentFallback = buildSegmentFallback(node.id);
  const nodeSegment = slugToLtreeSegment(node.slug, segmentFallback);
  const newPath = buildNodePath(parentPath, nodeSegment);
  const fallbackParentPath = node.parentId ? nodesById.get(node.parentId)?.path ?? null : null;
  const oldPath = node.path ?? buildNodePath(fallbackParentPath, nodeSegment);
  const timestamp = new Date();

  await db.transaction(async (tx: typeof db) => {
    await tx
      .update(knowledgeNodes)
      .set({ parentId: newParentId, path: newPath, updatedAt: timestamp })
      .where(and(eq(knowledgeNodes.id, nodeId), eq(knowledgeNodes.baseId, baseId)));

    if (node.parentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: timestamp })
        .where(and(eq(knowledgeNodes.id, node.parentId), eq(knowledgeNodes.baseId, baseId)));
    }

    if (newParentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: timestamp })
        .where(and(eq(knowledgeNodes.id, newParentId), eq(knowledgeNodes.baseId, baseId)));
    }

    await tx
      .update(knowledgeBases)
      .set({ updatedAt: timestamp })
      .where(eq(knowledgeBases.id, baseId));

    if (supportsLtree) {
      await tx.execute(sql`
        WITH params AS (
          SELECT text2ltree(${oldPath}) AS old_path, text2ltree(${newPath}) AS new_path
        )
        UPDATE "knowledge_nodes" AS kn
        SET "path" = params.new_path || subpath(kn."path", nlevel(params.old_path))
        FROM params
        WHERE kn."path" <@ params.old_path
          AND kn."id" <> ${node.id}
      `);
    } else if (oldPath && oldPath.length > 0) {
      const oldPrefix = `${oldPath}.`;
      const newPrefix = `${newPath}.`;
      const substringStart = oldPrefix.length + 1;

      await tx.execute(sql`
        UPDATE "knowledge_nodes"
        SET "path" = CASE
            WHEN "path" = ${oldPath} THEN ${newPath}
            ELSE ${newPrefix} || substring("path" FROM ${substringStart})
          END
        WHERE "base_id" = ${baseId}
          AND "id" <> ${node.id}
          AND (
            "path" = ${oldPath}
            OR "path" LIKE ${oldPrefix + "%"}
          )
      `);
    }
  });
}

import {
  type KnowledgeBaseSummary,
  type KnowledgeBaseTreeNode,
  type KnowledgeBaseNodeDetail,
  type KnowledgeBaseBreadcrumb,
  type KnowledgeBaseChildNode,
  type UpdateKnowledgeNodeParentRequest,
  type DeleteKnowledgeNodeResponse,
} from "@shared/knowledge-base";
import {
  knowledgeBases,
  knowledgeNodes,
  knowledgeBaseNodeTypes,
  type KnowledgeBaseNodeType,
  workspaces,
} from "@shared/schema";
import { db } from "./db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

export class KnowledgeBaseError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KnowledgeBaseError";
    this.status = status;
  }
}

type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;
type KnowledgeNodeRow = typeof knowledgeNodes.$inferSelect;

const NODE_TYPE_SET = new Set<KnowledgeBaseNodeType>(knowledgeBaseNodeTypes);

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
    children: child.type === "folder" ? buildTreeFromGroups(groups, child.id) : undefined,
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
    if (!parent || parent.type !== "folder") {
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
    childCount: child.type === "folder" ? (groups.get(child.id)?.length ?? 0) : 0,
    updatedAt: toIsoDate(child.updatedAt),
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

async function fetchWorkspaceBases(workspaceId: string): Promise<KnowledgeBaseRow[]> {
  return await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.workspaceId, workspaceId))
    .orderBy(desc(knowledgeBases.updatedAt), asc(knowledgeBases.name));
}

async function createDefaultBase(workspaceId: string): Promise<void> {
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
  const [base] = await db
    .select()
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, baseId), eq(knowledgeBases.workspaceId, workspaceId)))
    .limit(1);

  return base ?? null;
}

async function fetchBaseNodes(baseId: string): Promise<KnowledgeNodeRow[]> {
  return await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.baseId, baseId))
    .orderBy(asc(knowledgeNodes.position), asc(knowledgeNodes.createdAt));
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

  return {
    type: "document",
    id: node.id,
    title: node.title,
    content: node.content ?? "",
    updatedAt: toIsoDate(node.updatedAt),
    breadcrumbs: buildBreadcrumbs(base, node, nodesById),
  } satisfies KnowledgeBaseNodeDetail;
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

  await db.transaction(async (tx: typeof db) => {
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
      throw new KnowledgeBaseError("Родительский раздел не найден", 404);
    }

    if (parent.type !== "folder") {
      throw new KnowledgeBaseError("Родителем может быть только подраздел", 400);
    }

    const descendantIds = collectDescendants(groups, node.id, new Set<string>());
    if (descendantIds.has(newParentId) || newParentId === node.id) {
      throw new KnowledgeBaseError("Нельзя перенести подраздел внутрь самого себя", 400);
    }
  }

  await db.transaction(async (tx: typeof db) => {
    await tx
      .update(knowledgeNodes)
      .set({ parentId: newParentId, updatedAt: new Date() })
      .where(and(eq(knowledgeNodes.id, nodeId), eq(knowledgeNodes.baseId, baseId)));

    if (node.parentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: new Date() })
        .where(and(eq(knowledgeNodes.id, node.parentId), eq(knowledgeNodes.baseId, baseId)));
    }

    if (newParentId) {
      await tx
        .update(knowledgeNodes)
        .set({ updatedAt: new Date() })
        .where(and(eq(knowledgeNodes.id, newParentId), eq(knowledgeNodes.baseId, baseId)));
    }

    await tx
      .update(knowledgeBases)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeBases.id, baseId));
  });
}

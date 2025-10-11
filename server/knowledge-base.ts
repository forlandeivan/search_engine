import {
  type KnowledgeBaseSummary,
  type KnowledgeBaseTreeNode,
  type KnowledgeBaseNodeDetail,
  type KnowledgeBaseBreadcrumb,
  type KnowledgeBaseChildNode,
  type UpdateKnowledgeNodeParentRequest,
  type DeleteKnowledgeNodeResponse,
} from "@shared/knowledge-base";

export class KnowledgeBaseError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KnowledgeBaseError";
    this.status = status;
  }
}

type KnowledgeBaseNodeRecord = {
  id: string;
  title: string;
  type: "folder" | "document";
  parentId: string | null;
  children: string[];
  content?: string;
  updatedAt: string;
};

type KnowledgeBaseRecord = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  rootIds: string[];
  nodes: Record<string, KnowledgeBaseNodeRecord>;
};

const nowIso = () => new Date().toISOString();

const demoBase: KnowledgeBaseRecord = {
  id: "support",
  name: "Центр поддержки",
  description:
    "Структура внутренних руководств и статей для команды поддержки. Используйте страницы для работы с клиентами и обновляйте инструкции по мере изменений в продуктах.",
  updatedAt: nowIso(),
  rootIds: ["folder-getting-started", "doc-troubleshooting"],
  nodes: {
    "folder-getting-started": {
      id: "folder-getting-started",
      title: "Запуск команды",
      type: "folder",
      parentId: null,
      children: ["doc-overview", "folder-integrations"],
      updatedAt: nowIso(),
    },
    "folder-integrations": {
      id: "folder-integrations",
      title: "Интеграции",
      type: "folder",
      parentId: "folder-getting-started",
      children: ["doc-slack", "doc-crm"],
      updatedAt: nowIso(),
    },
    "doc-overview": {
      id: "doc-overview",
      title: "Как устроена служба поддержки",
      type: "document",
      parentId: "folder-getting-started",
      children: [],
      content:
        "## Добро пожаловать в базу знаний\n\nЭта статья рассказывает о ключевых принципах работы команды поддержки, SLA и каналах коммуникации. Актуализируйте её, когда меняются процессы.",
      updatedAt: nowIso(),
    },
    "doc-slack": {
      id: "doc-slack",
      title: "Подключение Slack",
      type: "document",
      parentId: "folder-integrations",
      children: [],
      content:
        "1. Откройте настройки рабочей области Slack.\n2. Сгенерируйте токен доступа.\n3. Добавьте токен в раздел интеграций платформы.\n4. Проверьте, что события начинают приходить в канал поддержки.",
      updatedAt: nowIso(),
    },
    "doc-crm": {
      id: "doc-crm",
      title: "Синхронизация с CRM",
      type: "document",
      parentId: "folder-integrations",
      children: [],
      content:
        "CRM подключается через API-ключ. Убедитесь, что у ключа есть доступ к сущностям \"Контакты\" и \"Сделки\". После активации синхронизации данные будут обновляться каждые 15 минут.",
      updatedAt: nowIso(),
    },
    "doc-troubleshooting": {
      id: "doc-troubleshooting",
      title: "Типовые ошибки пользователей",
      type: "document",
      parentId: null,
      children: [],
      content:
        "Собрали наиболее частые обращения пользователей и рекомендации по их решению. Обновляйте раздел по мере появления новых сценариев.",
      updatedAt: nowIso(),
    },
  },
};

const knowledgeBases = new Map<string, KnowledgeBaseRecord>([[demoBase.id, demoBase]]);

function assertKnowledgeBase(baseId: string): KnowledgeBaseRecord {
  const base = knowledgeBases.get(baseId);
  if (!base) {
    throw new KnowledgeBaseError("База знаний не найдена", 404);
  }
  return base;
}

function buildTree(base: KnowledgeBaseRecord, ids: string[]): KnowledgeBaseTreeNode[] {
  return ids
    .map((id) => base.nodes[id])
    .filter((node): node is KnowledgeBaseNodeRecord => Boolean(node))
    .map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      children: node.type === "folder" ? buildTree(base, node.children) : undefined,
    }));
}

function buildOverview(base: KnowledgeBaseRecord): KnowledgeBaseNodeDetail {
  return {
    type: "base",
    id: base.id,
    name: base.name,
    description: base.description,
    updatedAt: base.updatedAt,
    rootNodes: buildTree(base, base.rootIds),
  };
}

function collectDescendants(
  base: KnowledgeBaseRecord,
  nodeId: string,
  collected: Set<string> = new Set(),
): Set<string> {
  const node = base.nodes[nodeId];
  if (!node) {
    return collected;
  }

  for (const childId of node.children) {
    collected.add(childId);
    collectDescendants(base, childId, collected);
  }

  return collected;
}

function removeNode(base: KnowledgeBaseRecord, nodeId: string): DeleteKnowledgeNodeResponse {
  const node = base.nodes[nodeId];
  if (!node) {
    throw new KnowledgeBaseError("Элемент не найден", 404);
  }

  const toDelete = Array.from(collectDescendants(base, nodeId));
  toDelete.push(nodeId);

  if (node.parentId) {
    const parent = base.nodes[node.parentId];
    if (parent) {
      parent.children = parent.children.filter((child) => child !== nodeId);
      parent.updatedAt = nowIso();
    }
  } else {
    base.rootIds = base.rootIds.filter((id) => id !== nodeId);
  }

  for (const id of toDelete) {
    delete base.nodes[id];
  }

  base.updatedAt = nowIso();

  return { deletedIds: toDelete };
}

function isDescendant(base: KnowledgeBaseRecord, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) {
    return true;
  }

  const ancestor = base.nodes[ancestorId];
  if (!ancestor || ancestor.type !== "folder") {
    return false;
  }

  for (const childId of ancestor.children) {
    if (childId === candidateId) {
      return true;
    }
    if (isDescendant(base, childId, candidateId)) {
      return true;
    }
  }

  return false;
}

function moveNode(base: KnowledgeBaseRecord, nodeId: string, parentId: string | null): void {
  const node = base.nodes[nodeId];
  if (!node) {
    throw new KnowledgeBaseError("Элемент не найден", 404);
  }

  if (parentId === node.parentId) {
    return;
  }

  if (parentId && !base.nodes[parentId]) {
    throw new KnowledgeBaseError("Родительский раздел не найден", 404);
  }

  if (parentId && base.nodes[parentId]?.type !== "folder") {
    throw new KnowledgeBaseError("Родителем может быть только подраздел", 400);
  }

  if (parentId && isDescendant(base, nodeId, parentId)) {
    throw new KnowledgeBaseError("Нельзя перенести подраздел внутрь самого себя", 400);
  }

  if (node.parentId) {
    const currentParent = base.nodes[node.parentId];
    if (currentParent) {
      currentParent.children = currentParent.children.filter((child) => child !== nodeId);
      currentParent.updatedAt = nowIso();
    }
  } else {
    base.rootIds = base.rootIds.filter((id) => id !== nodeId);
  }

  node.parentId = parentId;

  if (parentId) {
    const targetParent = base.nodes[parentId];
    if (!targetParent) {
      throw new KnowledgeBaseError("Родительский раздел не найден", 404);
    }
    targetParent.children = [...targetParent.children, nodeId];
    targetParent.updatedAt = nowIso();
  } else {
    base.rootIds = [...base.rootIds, nodeId];
  }

  node.updatedAt = nowIso();
  base.updatedAt = nowIso();
}

function mapChildren(base: KnowledgeBaseRecord, node: KnowledgeBaseNodeRecord): KnowledgeBaseChildNode[] {
  return node.children
    .map((childId) => base.nodes[childId])
    .filter((child): child is KnowledgeBaseNodeRecord => Boolean(child))
    .map((child) => ({
      id: child.id,
      title: child.title,
      type: child.type,
      parentId: child.parentId,
      childCount: child.type === "folder" ? child.children.length : 0,
      updatedAt: child.updatedAt,
    }));
}

export function listKnowledgeBases(): KnowledgeBaseSummary[] {
  return Array.from(knowledgeBases.values()).map((base) => ({
    id: base.id,
    name: base.name,
    description: base.description,
    updatedAt: base.updatedAt,
    rootNodes: buildTree(base, base.rootIds),
  }));
}

export function getKnowledgeNodeDetail(baseId: string, nodeId: string): KnowledgeBaseNodeDetail {
  const base = assertKnowledgeBase(baseId);

  if (!nodeId || nodeId === "root") {
    return buildOverview(base);
  }

  const node = base.nodes[nodeId];
  if (!node) {
    throw new KnowledgeBaseError("Элемент не найден", 404);
  }

  if (node.type === "folder") {
    const breadcrumbs: KnowledgeBaseBreadcrumb[] = [
      { id: base.id, title: base.name, type: "base" },
    ];

    const chain: KnowledgeBaseBreadcrumb[] = [];
    let currentParentId = node.parentId;
    while (currentParentId) {
      const parent = base.nodes[currentParentId];
      if (!parent || parent.type !== "folder") {
        break;
      }
      chain.unshift({ id: parent.id, title: parent.title, type: "folder" });
      currentParentId = parent.parentId;
    }
    breadcrumbs.push(...chain);
    breadcrumbs.push({ id: node.id, title: node.title, type: "folder" });

    return {
      type: "folder",
      id: node.id,
      title: node.title,
      updatedAt: node.updatedAt,
      breadcrumbs,
      children: mapChildren(base, node),
      structure: buildTree(base, base.rootIds),
    };
  }

  const breadcrumbs: KnowledgeBaseBreadcrumb[] = [
    { id: base.id, title: base.name, type: "base" },
  ];

  const chain: KnowledgeBaseBreadcrumb[] = [];
  let currentParentId = node.parentId;
  while (currentParentId) {
    const parent = base.nodes[currentParentId];
    if (!parent || parent.type !== "folder") {
      break;
    }
    chain.unshift({ id: parent.id, title: parent.title, type: "folder" });
    currentParentId = parent.parentId;
  }
  breadcrumbs.push(...chain);

  return {
    type: "document",
    id: node.id,
    title: node.title,
    content: node.content ?? "",
    updatedAt: node.updatedAt,
    breadcrumbs,
  };
}

export function deleteKnowledgeNode(baseId: string, nodeId: string): DeleteKnowledgeNodeResponse {
  const base = assertKnowledgeBase(baseId);
  const result = removeNode(base, nodeId);
  return result;
}

export function updateKnowledgeNodeParent(
  baseId: string,
  nodeId: string,
  payload: UpdateKnowledgeNodeParentRequest,
): void {
  const base = assertKnowledgeBase(baseId);
  moveNode(base, nodeId, payload.parentId);
}

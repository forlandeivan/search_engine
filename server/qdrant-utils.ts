export function buildVectorPayload(
  vector: number[],
  _vectorFieldName?: string | null | undefined,
): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    return vector;
  }

  const sanitizedVector = vector.map((entry, index) => {
    if (typeof entry !== "number" || Number.isNaN(entry)) {
      throw new Error(`Некорректное значение компоненты вектора (index=${index})`);
    }

    if (!Number.isFinite(entry)) {
      throw new Error(`Компонента вектора содержит бесконечность (index=${index})`);
    }

    return entry;
  });

  return sanitizedVector;
}

function sanitizeCollectionName(source: string): string {
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
}

export function buildWorkspaceScopedCollectionName(
  workspaceId: string,
  projectId: string,
  collectionId: string,
): string {
  const workspaceSlug = sanitizeCollectionName(workspaceId);
  const projectSlug = sanitizeCollectionName(projectId);
  const collectionSlug = sanitizeCollectionName(collectionId);
  return `ws_${workspaceSlug}__proj_${projectSlug}__coll_${collectionSlug}`;
}


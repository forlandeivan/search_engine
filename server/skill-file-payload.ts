export const SKILL_FILE_SOURCE = "skill_file" as const;

export type SkillFileChunkPayload = {
  workspace_id: string;
  skill_id: string;
  doc_id: string;
  doc_version: number;
  source: typeof SKILL_FILE_SOURCE;
  chunk_id: string;
  chunk_index: number;
  chunk_text: string;
  original_name: string | null;
};

export type SkillFileVectorFilter = {
  must: Array<{ key: string; match: { value: string | number } }>;
};

export function buildSkillFileChunkPayload(params: {
  workspaceId: string;
  skillId: string;
  fileId: string;
  fileVersion: number;
  chunkId: string;
  chunkIndex: number;
  text: string;
  originalName?: string | null;
}): SkillFileChunkPayload {
  const workspaceId = params.workspaceId.trim();
  const skillId = params.skillId.trim();
  const docId = params.fileId.trim();

  if (!workspaceId || !skillId || !docId) {
    throw new Error("workspaceId, skillId и fileId обязательны для payload векторных точек");
  }

  return {
    workspace_id: workspaceId,
    skill_id: skillId,
    doc_id: docId,
    doc_version: params.fileVersion,
    source: SKILL_FILE_SOURCE,
    chunk_id: params.chunkId,
    chunk_index: params.chunkIndex,
    chunk_text: params.text,
    original_name: params.originalName ?? null,
  };
}

export function buildSkillFileVectorFilter(params: {
  workspaceId: string;
  skillId: string;
  fileId?: string | null;
  fileVersion?: number | null;
}): SkillFileVectorFilter {
  const must: SkillFileVectorFilter["must"] = [
    { key: "workspace_id", match: { value: params.workspaceId } },
    { key: "skill_id", match: { value: params.skillId } },
  ];

  if (params.fileId) {
    must.push({ key: "doc_id", match: { value: params.fileId } });
  }

  if (params.fileId && params.fileVersion !== null && params.fileVersion !== undefined) {
    must.push({ key: "doc_version", match: { value: params.fileVersion } });
  }

  return { must };
}

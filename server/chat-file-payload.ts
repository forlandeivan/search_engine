/**
 * Payload для векторов файлов чата в Qdrant
 */

export const CHAT_FILE_SOURCE = "chat_attachment" as const;

export type ChatFileChunkPayload = {
  workspace_id: string;
  skill_id: string;        // Для будущего переопыления
  chat_id: string;         // Для изоляции по умолчанию
  attachment_id: string;   // ID из chat_attachments
  doc_version: number;
  source: typeof CHAT_FILE_SOURCE;
  chunk_id: string;
  chunk_index: number;
  chunk_text: string;
  original_name: string | null;
  uploaded_by_user_id?: string | null;
};

export type ChatFileVectorFilter = {
  must: Array<{ key: string; match: { value: string | number } }>;
};

/**
 * Создать payload для точки вектора
 */
export function buildChatFileChunkPayload(params: {
  workspaceId: string;
  skillId: string;
  chatId: string;
  attachmentId: string;
  fileVersion: number;
  chunkId: string;
  chunkIndex: number;
  text: string;
  originalName?: string | null;
  uploadedByUserId?: string | null;
}): ChatFileChunkPayload {
  const { workspaceId, skillId, chatId, attachmentId } = params;

  if (!workspaceId?.trim() || !skillId?.trim() || !chatId?.trim() || !attachmentId?.trim()) {
    throw new Error("workspaceId, skillId, chatId и attachmentId обязательны для payload векторных точек");
  }

  return {
    workspace_id: workspaceId.trim(),
    skill_id: skillId.trim(),
    chat_id: chatId.trim(),
    attachment_id: attachmentId.trim(),
    doc_version: params.fileVersion,
    source: CHAT_FILE_SOURCE,
    chunk_id: params.chunkId,
    chunk_index: params.chunkIndex,
    chunk_text: params.text,
    original_name: params.originalName ?? null,
    uploaded_by_user_id: params.uploadedByUserId ?? null,
  };
}

/**
 * Создать фильтр для поиска по векторам
 * 
 * @param sharedChatFiles - если true, ищем по всем чатам навыка (переопыление)
 */
export function buildChatFileVectorFilter(params: {
  workspaceId: string;
  skillId: string;
  chatId: string;
  sharedChatFiles: boolean;
  attachmentId?: string | null;
}): ChatFileVectorFilter {
  const must: ChatFileVectorFilter["must"] = [
    { key: "workspace_id", match: { value: params.workspaceId } },
    { key: "skill_id", match: { value: params.skillId } },
    { key: "source", match: { value: CHAT_FILE_SOURCE } },
  ];

  // Если переопыление выключено — фильтруем по конкретному чату
  if (!params.sharedChatFiles) {
    must.push({ key: "chat_id", match: { value: params.chatId } });
  }

  // Опционально: фильтр по конкретному attachment
  if (params.attachmentId) {
    must.push({ key: "attachment_id", match: { value: params.attachmentId } });
  }

  return { must };
}

import { eq } from "drizzle-orm";
import { db } from "./db";
import { chatCards } from "@shared/schema";

export type ChatCardDto = {
  id: string;
  workspaceId: string;
  chatId: string;
  type: string;
  title: string | null;
  previewText: string | null;
  transcriptId: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

export async function getCardById(cardId: string, workspaceId: string): Promise<ChatCardDto | null> {
  const rows = await db
    .select()
    .from(chatCards)
    .where(eq(chatCards.id, cardId))
    .limit(1);

  const row = rows[0];
  if (!row || row.workspaceId !== workspaceId) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    chatId: row.chatId,
    type: row.type,
    title: row.title ?? null,
    previewText: row.previewText ?? null,
    transcriptId: row.transcriptId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? new Date(row.createdAt).toISOString(),
  };
}

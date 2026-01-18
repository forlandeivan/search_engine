/**
 * Chat Prepared Queries
 * 
 * Prepared statements for frequently used chat queries.
 * These are compiled once and reused for better performance.
 */

import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { chatSessions, chatMessages, chatCards, skills } from '@shared/schema';
import { db } from '../db';

/**
 * Get chat session by ID - prepared statement
 * Used when opening a chat
 */
export const getChatSessionByIdPrepared = db
  .select({
    chat: chatSessions,
    skillName: skills.name,
    skillIsSystem: skills.isSystem,
    skillStatus: skills.status,
    skillSystemKey: skills.systemKey,
  })
  .from(chatSessions)
  .innerJoin(skills, eq(chatSessions.skillId, skills.id))
  .where(
    and(
      eq(chatSessions.id, sql.placeholder('chatId')),
      isNull(chatSessions.deletedAt),
    ),
  )
  .limit(1)
  .prepare('get_chat_session_by_id');

/**
 * List chat messages - prepared statement
 * Used when loading chat messages (every chat open)
 */
export const listChatMessagesPrepared = db
  .select()
  .from(chatMessages)
  .where(eq(chatMessages.chatId, sql.placeholder('chatId')))
  .orderBy(chatMessages.createdAt)
  .prepare('list_chat_messages');

/**
 * Count chat messages - prepared statement
 * Used for pagination and limits
 */
export const countChatMessagesPrepared = db
  .select({ count: sql<number>`COUNT(*)` })
  .from(chatMessages)
  .where(eq(chatMessages.chatId, sql.placeholder('chatId')))
  .prepare('count_chat_messages');

/**
 * Get chat message by ID - prepared statement
 * Used when updating a message
 */
export const getChatMessageByIdPrepared = db
  .select()
  .from(chatMessages)
  .where(eq(chatMessages.id, sql.placeholder('messageId')))
  .limit(1)
  .prepare('get_chat_message_by_id');

/**
 * Get chat card by ID - prepared statement
 * Used when loading card content
 */
export const getChatCardByIdPrepared = db
  .select()
  .from(chatCards)
  .where(eq(chatCards.id, sql.placeholder('cardId')))
  .limit(1)
  .prepare('get_chat_card_by_id');

// Type-safe execution helpers
export async function getChatSessionById(chatId: string) {
  const result = await getChatSessionByIdPrepared.execute({ chatId });
  if (result.length === 0) return null;
  
  const { chat, skillName, skillIsSystem, skillSystemKey, skillStatus } = result[0];
  return {
    ...chat,
    skillName: skillName ?? null,
    skillIsSystem: Boolean(skillIsSystem),
    skillStatus: skillStatus ?? null,
    skillSystemKey: skillSystemKey ?? null,
  };
}

export async function listChatMessages(chatId: string) {
  return await listChatMessagesPrepared.execute({ chatId });
}

export async function countChatMessages(chatId: string) {
  const result = await countChatMessagesPrepared.execute({ chatId });
  return Number(result[0]?.count ?? 0);
}

export async function getChatMessageById(messageId: string) {
  const result = await getChatMessageByIdPrepared.execute({ messageId });
  return result[0] ?? undefined;
}

export async function getChatCardById(cardId: string) {
  const result = await getChatCardByIdPrepared.execute({ cardId });
  return result[0] ?? undefined;
}

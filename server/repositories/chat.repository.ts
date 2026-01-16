/**
 * Chat Repository
 * 
 * Handles all chat-related database operations.
 * Extracted from storage.ts for better code organization.
 */

import { eq, desc, and, isNull, ilike, sql } from 'drizzle-orm';
import {
  chatSessions,
  chatMessages,
  chatCards,
  chatAttachments,
  skills,
  type ChatSession,
  type ChatSessionInsert,
  type ChatMessage,
  type ChatMessageInsert,
  type ChatCard,
  type ChatCardInsert,
  type ChatAttachment,
  type ChatAttachmentInsert,
  type ChatMessageMetadata,
  type AssistantActionType,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('chat-repository');

/**
 * Chat session with skill info
 */
export interface ChatSessionWithSkill extends ChatSession {
  skillName: string | null;
  skillIsSystem: boolean;
  skillSystemKey?: string | null;
  skillStatus?: string | null;
}

/**
 * Chat Repository - handles all chat data operations
 */
export const chatRepository = {
  /**
   * List chat sessions for user
   */
  async listSessions(
    workspaceId: string,
    userId: string,
    searchQuery?: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<ChatSessionWithSkill[]> {
    let condition = and(
      eq(chatSessions.workspaceId, workspaceId),
      eq(chatSessions.userId, userId),
      isNull(chatSessions.deletedAt),
    );

    if (!options.includeArchived) {
      condition = and(condition, eq(chatSessions.status, 'active'));
    }

    const trimmedQuery = searchQuery?.trim();
    if (trimmedQuery) {
      condition = and(condition, ilike(chatSessions.title, `%${trimmedQuery}%`));
    }

    const rows = await db
      .select({
        chat: chatSessions,
        skillName: skills.name,
        skillIsSystem: skills.isSystem,
        skillStatus: skills.status,
        skillSystemKey: skills.systemKey,
      })
      .from(chatSessions)
      .innerJoin(skills, eq(chatSessions.skillId, skills.id))
      .where(condition)
      .orderBy(desc(chatSessions.updatedAt));

    return rows.map(
      ({
        chat,
        skillName,
        skillIsSystem,
        skillSystemKey,
        skillStatus,
      }: {
        chat: ChatSession;
        skillName: string | null;
        skillIsSystem: boolean | null;
        skillStatus: string | null;
        skillSystemKey: string | null;
      }) => ({
        ...chat,
        skillName: skillName ?? null,
        skillIsSystem: Boolean(skillIsSystem),
        skillStatus: skillStatus ?? null,
        skillSystemKey: skillSystemKey ?? null,
      }),
    );
  },

  /**
   * Get chat session by ID
   */
  async getById(chatId: string): Promise<ChatSessionWithSkill | null> {
    const rows = await db
      .select({
        chat: chatSessions,
        skillName: skills.name,
        skillIsSystem: skills.isSystem,
        skillStatus: skills.status,
        skillSystemKey: skills.systemKey,
      })
      .from(chatSessions)
      .innerJoin(skills, eq(chatSessions.skillId, skills.id))
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)));

    if (rows.length === 0) {
      return null;
    }

    const { chat, skillName, skillIsSystem, skillSystemKey, skillStatus } = rows[0];
    return {
      ...chat,
      skillName: skillName ?? null,
      skillIsSystem: Boolean(skillIsSystem),
      skillStatus: skillStatus ?? null,
      skillSystemKey: skillSystemKey ?? null,
    };
  },

  /**
   * Create a new chat session
   */
  async create(values: ChatSessionInsert): Promise<ChatSession> {
    const [created] = await db.insert(chatSessions).values(values).returning();
    return created;
  },

  /**
   * Update chat session
   */
  async update(
    chatId: string,
    updates: Partial<
      Pick<
        ChatSessionInsert,
        | 'title'
        | 'currentAssistantActionType'
        | 'currentAssistantActionText'
        | 'currentAssistantActionTriggerMessageId'
        | 'currentAssistantActionUpdatedAt'
      >
    >,
  ): Promise<ChatSession | null> {
    if (!updates || Object.keys(updates).length === 0) {
      const current = await this.getById(chatId);
      return current ?? null;
    }

    const [updated] = await db
      .update(chatSessions)
      .set({
        ...updates,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning();

    return updated ?? null;
  },

  /**
   * Set assistant action on chat
   */
  async setAssistantAction(
    chatId: string,
    action: {
      type: AssistantActionType | null;
      text: string | null;
      triggerMessageId: string | null;
      updatedAt: Date | null;
    },
  ): Promise<ChatSession | null> {
    const [updated] = await db
      .update(chatSessions)
      .set({
        currentAssistantActionType: action.type,
        currentAssistantActionText: action.text,
        currentAssistantActionTriggerMessageId: action.triggerMessageId,
        currentAssistantActionUpdatedAt: action.updatedAt,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning();

    return updated ?? null;
  },

  /**
   * Clear assistant action on chat
   */
  async clearAssistantAction(chatId: string): Promise<ChatSession | null> {
    const [updated] = await db
      .update(chatSessions)
      .set({
        currentAssistantActionType: null,
        currentAssistantActionText: null,
        currentAssistantActionTriggerMessageId: null,
        currentAssistantActionUpdatedAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning();

    return updated ?? null;
  },

  /**
   * Touch chat session (update updatedAt)
   */
  async touch(chatId: string): Promise<void> {
    await db
      .update(chatSessions)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)));
  },

  /**
   * Soft delete chat session
   */
  async softDelete(chatId: string): Promise<boolean> {
    const [deleted] = await db
      .update(chatSessions)
      .set({
        deletedAt: sql`CURRENT_TIMESTAMP`,
        status: 'deleted',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning({ id: chatSessions.id });

    return Boolean(deleted);
  },

  /**
   * Update chat title if empty
   */
  async updateTitleIfEmpty(chatId: string, title: string): Promise<boolean> {
    const [updated] = await db
      .update(chatSessions)
      .set({ title, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(chatSessions.id, chatId),
          isNull(chatSessions.deletedAt),
          sql`(${chatSessions.title} IS NULL OR TRIM(${chatSessions.title}) = '')`,
        ),
      )
      .returning({ id: chatSessions.id });

    return Boolean(updated);
  },

  // Chat Messages

  /**
   * List messages for chat
   */
  async listMessages(chatId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(chatMessages.createdAt);
  },

  /**
   * Count messages in chat
   */
  async countMessages(chatId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId));

    return Number(result?.count ?? 0);
  },

  /**
   * Create a new chat message
   */
  async createMessage(values: ChatMessageInsert): Promise<ChatMessage> {
    const [created] = await db
      .insert(chatMessages)
      .values({
        ...values,
        metadata: values.metadata ?? {},
      })
      .returning();
    return created;
  },

  /**
   * Get chat message by ID
   */
  async getMessage(id: string): Promise<ChatMessage | undefined> {
    const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return message ?? undefined;
  },

  /**
   * Update chat message
   */
  async updateMessage(
    id: string,
    updates: Partial<Pick<ChatMessage, 'content' | 'metadata'>>,
  ): Promise<ChatMessage | undefined> {
    const cleanUpdates: Record<string, unknown> = {};

    if (updates.content !== undefined) {
      cleanUpdates.content = updates.content;
    }
    if (updates.metadata !== undefined) {
      cleanUpdates.metadata = updates.metadata;
    }

    if (Object.keys(cleanUpdates).length === 0) {
      return this.getMessage(id);
    }

    const [updated] = await db
      .update(chatMessages)
      .set(cleanUpdates)
      .where(eq(chatMessages.id, id))
      .returning();

    return updated ?? undefined;
  },

  /**
   * Find chat message by transcript ID (stored in metadata)
   */
  async findByTranscriptId(transcriptId: string): Promise<ChatMessage | undefined> {
    const [message] = await db
      .select()
      .from(chatMessages)
      .where(sql`${chatMessages.metadata}->>'transcriptId' = ${transcriptId}`);
    return message ?? undefined;
  },

  /**
   * Find chat message by result ID (stored in metadata)
   */
  async findByResultId(chatId: string, resultId: string): Promise<ChatMessage | undefined> {
    const [message] = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          sql`${chatMessages.metadata}->>'resultId' = ${resultId}`,
        ),
      );
    return message ?? undefined;
  },

  /**
   * Find chat message by stream ID (stored in metadata)
   */
  async findByStreamId(chatId: string, streamId: string): Promise<ChatMessage | undefined> {
    const [message] = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          sql`${chatMessages.metadata}->>'streamId' = ${streamId}`,
        ),
      );
    return message ?? undefined;
  },

  // Chat Cards

  /**
   * Create a chat card
   */
  async createCard(values: ChatCardInsert): Promise<ChatCard> {
    const [created] = await db.insert(chatCards).values(values).returning();
    return created;
  },

  /**
   * Get chat card by ID
   */
  async getCard(id: string): Promise<ChatCard | undefined> {
    const [card] = await db.select().from(chatCards).where(eq(chatCards.id, id));
    return card ?? undefined;
  },

  /**
   * Update chat card
   */
  async updateCard(
    id: string,
    updates: Partial<Pick<ChatCard, 'previewText' | 'title'>>,
  ): Promise<ChatCard | undefined> {
    const [updated] = await db
      .update(chatCards)
      .set({ ...updates })
      .where(eq(chatCards.id, id))
      .returning();
    return updated ?? undefined;
  },

  // Chat Attachments

  /**
   * Create a chat attachment
   */
  async createAttachment(values: ChatAttachmentInsert): Promise<ChatAttachment> {
    const [created] = await db.insert(chatAttachments).values(values).returning();
    return created;
  },

  /**
   * Get attachment by message ID
   */
  async findAttachmentByMessageId(messageId: string): Promise<ChatAttachment | undefined> {
    const [attachment] = await db
      .select()
      .from(chatAttachments)
      .where(eq(chatAttachments.messageId, messageId));
    return attachment ?? undefined;
  },

  /**
   * Get attachment by ID
   */
  async getAttachment(id: string): Promise<ChatAttachment | undefined> {
    const [attachment] = await db.select().from(chatAttachments).where(eq(chatAttachments.id, id));
    return attachment ?? undefined;
  },
};

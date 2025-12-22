import { storage } from "./storage";
import { applyContextLimitByCharacters, type ChatConversationMessage, mapChatSummary } from "./chat-service";
import type { SkillDto } from "@shared/skills";
import { getSkillById } from "./skills";
import { mapChatSummary } from "./chat-service";

export type ContextPackLimits = {
  unit: "characters";
  configuredLimit: number | null;
  appliedLimit: number | null;
  wasTruncated: boolean;
  originalSize: number;
  finalSize: number;
};

export type ContextPackMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ContextPack = {
  schemaVersion: 1;
  workspaceId: string;
  chatId: string;
  skillId: string;
  triggerMessageId: string;
  createdAt: string;
  actor: { userId: string };
  limits: ContextPackLimits;
  chatMeta: {
    title: string | null;
    status: string | null;
  };
  skillMeta: {
    executionMode: SkillDto["executionMode"];
    mode: SkillDto["mode"];
  };
  history: ContextPackMessage[];
};

export async function buildContextPack(opts: {
  workspaceId: string;
  chatId: string;
  skillId: string;
  triggerMessageId: string;
  userId: string;
  limitCharacters: number | null;
}): Promise<ContextPack> {
  const chatRecord = await storage.getChatSessionById(opts.chatId);
  if (!chatRecord || chatRecord.workspaceId !== opts.workspaceId) {
    throw new Error("Chat not found or not in workspace");
  }
  const chat = mapChatSummary(chatRecord);
  const skill = await getSkillById(opts.workspaceId, opts.skillId);
  if (!skill) {
    throw new Error("Skill not found");
  }

  const rawMessages = await storage.listChatMessages(opts.chatId);
  const conversation: ChatConversationMessage[] = rawMessages.map((entry) => ({
    role: entry.role,
    content: entry.content ?? "",
  }));
  const originalSize = conversation.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
  const limitedMessages = applyContextLimitByCharacters(conversation, opts.limitCharacters);
  const finalSize = limitedMessages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);

  const history: ContextPackMessage[] = rawMessages
    .slice(rawMessages.length - limitedMessages.length)
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      text: entry.content ?? "",
      createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : String(entry.createdAt),
      metadata: entry.metadata ?? {},
    }));

  return {
    schemaVersion: 1,
    workspaceId: opts.workspaceId,
    chatId: opts.chatId,
    skillId: opts.skillId,
    triggerMessageId: opts.triggerMessageId,
    createdAt: new Date().toISOString(),
    actor: { userId: opts.userId },
    limits: {
      unit: "characters",
      configuredLimit: opts.limitCharacters,
      appliedLimit: opts.limitCharacters,
      wasTruncated: finalSize < originalSize,
      originalSize,
      finalSize,
    },
    chatMeta: {
      title: chat.title ?? null,
      status: chat.status ?? null,
    },
    skillMeta: {
      executionMode: skill.executionMode,
      mode: skill.mode,
    },
    history,
  };
}

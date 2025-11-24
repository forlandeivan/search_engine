import { chatTitleGeneratorService } from "./chat-title-generator";
import { storage } from "./storage";

type ScheduleArgs = {
  chatId: string;
  workspaceId: string;
  userId: string;
  messageText: string;
  chatTitle?: string | null;
};

type JobPayload = {
  chatId: string;
  workspaceId: string;
  userId: string;
  messageText: string;
};

const pendingChatTitleJobs = new Set<string>();
const CHAT_TITLE_GENERATION_DELAY_MS = 500;

export function scheduleChatTitleGenerationIfNeeded(args: ScheduleArgs): void {
  const trimmedMessage = (args.messageText ?? "").trim();
  if (!trimmedMessage) {
    return;
  }
  if (args.chatTitle && args.chatTitle.trim().length > 0) {
    return;
  }

  void (async () => {
    try {
      const messageCount = await storage.countChatMessages(args.chatId);
      if (messageCount !== 1) {
        return;
      }
      enqueueChatTitleGenerationJob({
        chatId: args.chatId,
        workspaceId: args.workspaceId,
        userId: args.userId,
        messageText: trimmedMessage,
      });
    } catch (error) {
      console.warn(
        `[chat-title-job] failed to evaluate scheduling for chat=${args.chatId}:`,
        error instanceof Error ? error : String(error),
      );
    }
  })();
}

function enqueueChatTitleGenerationJob(payload: JobPayload) {
  if (pendingChatTitleJobs.has(payload.chatId)) {
    return;
  }
  pendingChatTitleJobs.add(payload.chatId);
  const timer = setTimeout(() => {
    runChatTitleGenerationJob(payload)
      .catch((error) => {
        console.warn(
          `[chat-title-job] failed for chat=${payload.chatId}:`,
          error instanceof Error ? error : String(error),
        );
      })
      .finally(() => {
        pendingChatTitleJobs.delete(payload.chatId);
      });
  }, CHAT_TITLE_GENERATION_DELAY_MS);
  timer.unref?.();
}

async function runChatTitleGenerationJob(payload: JobPayload) {
  const chat = await storage.getChatSessionById(payload.chatId);
  if (!chat) {
    return;
  }

  const normalizedTitle = chat.title?.trim?.() ?? chat.title ?? "";
  if (normalizedTitle) {
    return;
  }
  if (chat.workspaceId !== payload.workspaceId || chat.userId !== payload.userId) {
    return;
  }

  const generatedTitle = await chatTitleGeneratorService.generateTitleForChat({
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    chatId: payload.chatId,
    firstMessageText: payload.messageText,
  });

  if (!generatedTitle) {
    return;
  }

  const updated = await storage.updateChatTitleIfEmpty(payload.chatId, generatedTitle);
  if (updated) {
    console.info(`[chat-title-job] chat=${payload.chatId} title generated`);
  }
}

export function __resetChatTitleJobQueueForTests() {
  pendingChatTitleJobs.clear();
}

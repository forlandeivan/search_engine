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
const AUDIO_TITLE_MAX_LENGTH = 80;

function extractAudioFileName(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("__AUDIO_FILE__:")) {
    return trimmed.substring("__AUDIO_FILE__:".length).trim() || null;
  }
  return null;
}

function buildAudioTitle(fileName: string): string | null {
  if (!fileName) return null;
  const base = fileName.split("/").pop() ?? fileName;
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[_]+/g, " ").trim();
  if (!cleaned) return null;
  const limited = cleaned.length > AUDIO_TITLE_MAX_LENGTH ? cleaned.slice(0, AUDIO_TITLE_MAX_LENGTH).trim() : cleaned;
  return limited || null;
}

export function scheduleChatTitleGenerationIfNeeded(args: ScheduleArgs): void {
  const rawMessage = args.messageText ?? "";
  const trimmedMessage = rawMessage.trim();
  const hasTitleAlready = args.chatTitle && args.chatTitle.trim().length > 0;
  if (hasTitleAlready) {
    return;
  }

  const audioFileName = extractAudioFileName(trimmedMessage);
  if (audioFileName) {
    void (async () => {
      try {
        const messageCount = await storage.countChatMessages(args.chatId);
        if (messageCount !== 1) {
          return;
        }
        const title = buildAudioTitle(audioFileName);
        if (!title) return;
        const updated = await storage.updateChatTitleIfEmpty(args.chatId, title);
        if (updated) {
          console.info(`[chat-title-job] chat=${args.chatId} title set from audio file: ${title}`);
        }
      } catch (error) {
        console.warn(
          `[chat-title-job] failed to set audio title for chat=${args.chatId}:`,
          error instanceof Error ? error : String(error),
        );
      }
    })();
    return;
  }

  if (!trimmedMessage) {
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

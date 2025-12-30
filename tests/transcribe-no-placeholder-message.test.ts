/* @vitest-environment node */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { createServer } from "http";
import type { Express } from "express";
import express from "express";
import type { IStorage } from "../server/storage";
import type { ChatService } from "../server/chat-service";
import { registerRoutes } from "../server/routes";

// Mock storage
const storageMock = {
  createChatMessage: vi.fn(),
  createTranscript: vi.fn(),
  createFile: vi.fn(),
  getChatSessionById: vi.fn(),
} as unknown as IStorage;

// Mock chat service
const chatServiceMock = {
  getChatById: vi.fn(),
} as unknown as ChatService;

// Mock yandex-stt-async-service
vi.mock("../server/yandex-stt-async-service", () => ({
  yandexSttAsyncService: {
    startAsyncTranscription: vi.fn(),
    setOperationContext: vi.fn(),
  },
}));

// Mock asr-execution-log-service
vi.mock("../server/asr-execution-log-service", () => ({
  asrExecutionLogService: {
    createExecution: vi.fn(),
    addEvent: vi.fn(),
  },
}));

// Mock other dependencies
vi.mock("../server/storage", () => ({
  storage: storageMock,
}));

vi.mock("../server/chat-service", () => ({
  chatService: chatServiceMock,
  upsertBotActionForChat: vi.fn(),
}));

async function createTestServer(): Promise<{ httpServer: Server; app: Express }> {
  const app = express();
  app.use(express.json());
  const server = await registerRoutes(app);
  const httpServer = createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });
  return { httpServer, app };
}

describe("Transcribe API - no placeholder messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("does not create placeholder message when starting transcription", async () => {
    const { upsertBotActionForChat } = await import("../server/chat-service");
    const { yandexSttAsyncService } = await import("../server/yandex-stt-async-service");
    const { asrExecutionLogService } = await import("../server/asr-execution-log-service");

    // Setup mocks
    (storageMock.getChatSessionById as any).mockResolvedValue({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });

    (storageMock.createChatMessage as any).mockResolvedValue({
      id: "audio-msg-1",
      chatId: "chat-1",
      role: "user",
      content: "audio.mp3",
      createdAt: new Date().toISOString(),
    });

    (storageMock.createTranscript as any).mockResolvedValue({
      id: "transcript-1",
      chatId: "chat-1",
      status: "processing",
    });

    (storageMock.createFile as any).mockResolvedValue({
      id: "file-1",
    });

    (asrExecutionLogService.createExecution as any).mockResolvedValue({
      id: "asr-exec-1",
    });

    (yandexSttAsyncService.startAsyncTranscription as any).mockResolvedValue({
      operationId: "op-1",
      message: "Started",
      uploadResult: {
        uri: "s3://bucket/file.ogg",
        objectKey: "file.ogg",
      },
    });

    (upsertBotActionForChat as any).mockResolvedValue({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "transcribe-transcript-1",
      actionType: "transcribe_audio",
      status: "processing",
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      
      // Create a mock file upload
      const formData = new FormData();
      const blob = new Blob(["fake audio"], { type: "audio/mpeg" });
      formData.append("audio", blob, "test.mp3");
      formData.append("workspaceId", "workspace-1");
      formData.append("chatId", "chat-1");

      const response = await fetch(`http://127.0.0.1:${address.port}/api/transcribe`, {
        method: "POST",
        body: formData as any,
        headers: {
          "Cookie": "session=test-session",
        },
      });

      // Проверяем, что placeholder message НЕ был создан
      const createChatMessageCalls = (storageMock.createChatMessage as any).mock.calls;
      const placeholderMessages = createChatMessageCalls.filter((call: any[]) => {
        const message = call[0];
        return (
          message.role === "assistant" &&
          (message.content.includes("Идёт расшифровка") ||
            message.content.includes("Аудиозапись загружена") ||
            (message.metadata?.transcriptStatus === "processing"))
        );
      });

      expect(placeholderMessages.length).toBe(0);
      
      // Проверяем, что bot_action был создан
      expect(upsertBotActionForChat).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "transcribe_audio",
          status: "processing",
        }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});


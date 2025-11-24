import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/storage", () => ({
  storage: {
    countChatMessages: vi.fn(),
    getChatSessionById: vi.fn(),
    updateChatTitleIfEmpty: vi.fn(),
  },
}));

vi.mock("../server/chat-title-generator", () => ({
  chatTitleGeneratorService: {
    generateTitleForChat: vi.fn(),
  },
}));

import {
  scheduleChatTitleGenerationIfNeeded,
  __resetChatTitleJobQueueForTests,
} from "../server/chat-title-jobs";
import { storage } from "../server/storage";
import { chatTitleGeneratorService } from "../server/chat-title-generator";

async function flushAllTimers() {
  await Promise.resolve();
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

describe("chat-title background jobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetChatTitleJobQueueForTests();
    vi.clearAllMocks();
    vi.mocked(storage.countChatMessages).mockResolvedValue(1);
    vi.mocked(storage.getChatSessionById).mockResolvedValue({
      id: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      skillName: null,
      skillIsSystem: false,
      skillSystemKey: null,
    });
    vi.mocked(storage.updateChatTitleIfEmpty).mockResolvedValue(true);
    vi.mocked(chatTitleGeneratorService.generateTitleForChat).mockResolvedValue("Auto title");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueues job and updates title on first message", async () => {
    scheduleChatTitleGenerationIfNeeded({
      chatId: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      messageText: "Hello world",
    });

    await flushAllTimers();

    expect(storage.countChatMessages).toHaveBeenCalledWith("chat-1");
    expect(chatTitleGeneratorService.generateTitleForChat).toHaveBeenCalledWith({
      chatId: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      firstMessageText: "Hello world",
    });
    expect(storage.updateChatTitleIfEmpty).toHaveBeenCalledWith("chat-1", "Auto title");
  });

  it("skips scheduling when chat already has title", async () => {
    scheduleChatTitleGenerationIfNeeded({
      chatId: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      messageText: "Hello world",
      chatTitle: "Already named",
    });

    await flushAllTimers();

    expect(storage.countChatMessages).not.toHaveBeenCalled();
  });

  it("does not enqueue when message count is not first", async () => {
    vi.mocked(storage.countChatMessages).mockResolvedValue(2);

    scheduleChatTitleGenerationIfNeeded({
      chatId: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      messageText: "Second message",
    });

    await flushAllTimers();

    expect(chatTitleGeneratorService.generateTitleForChat).not.toHaveBeenCalled();
  });

  it("does not overwrite custom title", async () => {
    vi.mocked(storage.getChatSessionById).mockResolvedValue({
      id: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Custom",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      skillName: null,
      skillIsSystem: false,
      skillSystemKey: null,
    });

    scheduleChatTitleGenerationIfNeeded({
      chatId: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      messageText: "Hello world",
    });

    await flushAllTimers();

    expect(chatTitleGeneratorService.generateTitleForChat).not.toHaveBeenCalled();
  });
});

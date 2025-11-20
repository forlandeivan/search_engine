import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/storage", () => ({
  storage: {
    listChatSessions: vi.fn(),
    getChatSessionById: vi.fn(),
    createChatSession: vi.fn(),
    updateChatSession: vi.fn(),
    touchChatSession: vi.fn(),
    softDeleteChatSession: vi.fn(),
    listChatMessages: vi.fn(),
    createChatMessage: vi.fn(),
  },
}));

vi.mock("../server/skills", () => ({
  getSkillById: vi.fn(),
}));

import { storage } from "../server/storage";
import { getSkillById } from "../server/skills";

import {
  addUserMessage,
  ChatServiceError,
  createChat,
  deleteChat,
  getChatMessages,
  listUserChats,
} from "../server/chat-service";

const storageMock = vi.mocked(storage);
const getSkillByIdMock = vi.mocked(getSkillById);

const baseChat = {
  id: "chat-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  skillId: "skill-1",
  title: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  skillName: "Test",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("chat service", () => {
  it("returns user chats", async () => {
    storageMock.listChatSessions.mockResolvedValueOnce([baseChat as any]);

    const result = await listUserChats("workspace-1", "user-1");

    expect(result).toHaveLength(1);
    expect(storageMock.listChatSessions).toHaveBeenCalledWith("workspace-1", "user-1", undefined);
  });

  it("fails to create chat when skill is missing", async () => {
    getSkillByIdMock.mockResolvedValueOnce(null as any);

    await expect(() =>
      createChat({ workspaceId: "workspace-1", userId: "user-1", skillId: "skill-1" }),
    ).rejects.toThrow(ChatServiceError);
  });

  it("creates chat when skill exists", async () => {
    getSkillByIdMock.mockResolvedValueOnce({ id: "skill-1", name: "Skill" } as any);
    storageMock.createChatSession.mockResolvedValueOnce(baseChat as any);

    const chat = await createChat({
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: " My chat ",
    });

    expect(chat.skillName).toBe("Skill");
    expect(storageMock.createChatSession).toHaveBeenCalled();
  });

  it("prevents access to foreign chats", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      workspaceId: "workspace-2",
    } as any);

    await expect(() => getChatMessages("chat-1", "workspace-1", "user-1")).rejects.toThrow(
      ChatServiceError,
    );
  });

  it("prevents access to chats of another user", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      userId: "other-user",
    } as any);

    await expect(() => getChatMessages("chat-1", "workspace-1", "user-1")).rejects.toThrow(
      ChatServiceError,
    );
  });

  it("deletes own chat", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    storageMock.softDeleteChatSession.mockResolvedValueOnce(true);

    await deleteChat("chat-1", "workspace-1", "user-1");
    expect(storageMock.softDeleteChatSession).toHaveBeenCalledWith("chat-1");
  });

  it("adds user message and touches chat", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    storageMock.createChatMessage.mockResolvedValueOnce({
      id: "msg-1",
      chatId: "chat-1",
      role: "user",
      content: "hello",
      metadata: {},
      createdAt: new Date().toISOString(),
    } as any);

    await addUserMessage("chat-1", "workspace-1", "user-1", "hello");

    expect(storageMock.createChatMessage).toHaveBeenCalled();
    expect(storageMock.touchChatSession).toHaveBeenCalledWith("chat-1");
  });

  it("does not add messages to a chat of another user", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      userId: "user-2",
    } as any);

    await expect(() =>
      addUserMessage("chat-1", "workspace-1", "user-1", "hello"),
    ).rejects.toThrow(ChatServiceError);
  });
});

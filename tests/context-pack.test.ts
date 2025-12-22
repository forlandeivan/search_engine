import { describe, expect, it, beforeEach, vi } from "vitest";

const storageMock = {
  getChatSessionById: vi.fn(),
  listChatMessages: vi.fn(),
};

vi.doMock("../server/storage", () => ({ storage: storageMock }));
vi.doMock("../server/chat-service", async () => {
  const actual = await vi.importActual<typeof import("../server/chat-service")>("../server/chat-service");
  return {
    ...actual,
    mapChatSummary: (row: any) => row,
  };
});

const getSkillByIdMock = vi.fn();
vi.doMock("../server/skills", () => ({
  getSkillById: getSkillByIdMock,
}));

describe("buildContextPack", () => {
  beforeEach(() => {
    vi.resetModules();
    storageMock.getChatSessionById.mockReset();
    storageMock.listChatMessages.mockReset();
    getSkillByIdMock.mockReset();
  });

  it("applies character limit and reports truncation", async () => {
    const { buildContextPack } = await import("../server/context-pack");
    storageMock.getChatSessionById.mockResolvedValue({
      id: "chat-1",
      workspaceId: "ws-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Test",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      skillStatus: "active",
    });
    storageMock.listChatMessages.mockResolvedValue([
      { id: "m1", chatId: "chat-1", role: "user", content: "Hello world", metadata: {}, createdAt: new Date() },
      { id: "m2", chatId: "chat-1", role: "assistant", content: "Long answer text", metadata: {}, createdAt: new Date() },
    ]);
    getSkillByIdMock.mockResolvedValue({
      id: "skill-1",
      workspaceId: "ws-1",
      executionMode: "standard",
      mode: "llm",
    });

    const pack = await buildContextPack({
      workspaceId: "ws-1",
      chatId: "chat-1",
      skillId: "skill-1",
      triggerMessageId: "m1",
      userId: "user-1",
      limitCharacters: 12,
    });

    expect(pack.history.length).toBe(1);
    expect(pack.history[0].id).toBe("m2");
    expect(pack.limits.wasTruncated).toBe(true);
    expect(pack.limits.originalSize).toBeGreaterThan(pack.limits.finalSize);
  });
});

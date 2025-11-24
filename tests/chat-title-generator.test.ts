import { describe, it, expect, beforeEach, vi } from "vitest";
import { chatTitleGeneratorService } from "../server/chat-title-generator";
import { createUnicaChatSkillForWorkspace } from "../server/skills";
import { storage } from "../server/storage";
import { fetchAccessToken } from "../server/llm-access-token";
import { executeLlmCompletion } from "../server/llm-client";

vi.mock("../server/skills", () => ({
  createUnicaChatSkillForWorkspace: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storage: {
    getUnicaChatConfig: vi.fn(),
    getLlmProvider: vi.fn(),
  },
}));

vi.mock("../server/llm-access-token", () => ({
  fetchAccessToken: vi.fn(),
}));

vi.mock("../server/llm-client", () => ({
  executeLlmCompletion: vi.fn(),
}));

vi.mock("../server/llm-utils", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/llm-utils")>();
  return {
    ...mod,
    sanitizeLlmModelOptions: vi.fn(mod.sanitizeLlmModelOptions),
  };
});

const mockSkill = {
  id: "skill-1",
  llmProviderConfigId: "provider-1",
  modelId: "gpt-test",
  systemPrompt: null,
};

const mockProvider = {
  id: "provider-1",
  completionUrl: "https://llm.test",
  tokenUrl: "https://llm.test/token",
  authorizationKey: "test",
  scope: "scope",
  requestHeaders: {},
  allowSelfSignedCertificate: false,
  providerType: "custom",
  model: "gpt-base",
  requestConfig: {},
  responseConfig: {},
  isActive: true,
};

const SAMPLE_MESSAGE = "Suggest growth strategies for an online electronics store.";
const FALLBACK_TITLE = "\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442";

describe("chatTitleGeneratorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createUnicaChatSkillForWorkspace as vi.Mock).mockResolvedValue({ ...mockSkill });
    (storage.getUnicaChatConfig as vi.Mock).mockResolvedValue({});
    (storage.getLlmProvider as vi.Mock).mockResolvedValue({ ...mockProvider });
    (fetchAccessToken as vi.Mock).mockResolvedValue("token");
    (executeLlmCompletion as vi.Mock).mockResolvedValue({
      answer: '"Store strategy ideas."',
      request: { url: "", headers: {}, body: {} },
    });
  });

  it("returns cleaned title for normal message", async () => {
    const title = await chatTitleGeneratorService.generateTitleForChat({
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      firstMessageText: SAMPLE_MESSAGE,
    });
    expect(title).toBe("Store strategy ideas");
    expect(executeLlmCompletion).toHaveBeenCalledTimes(1);
  });

  it("returns fallback for empty message", async () => {
    const title = await chatTitleGeneratorService.generateTitleForChat({
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      firstMessageText: "   ",
    });
    expect(title).toBe(FALLBACK_TITLE);
  });

  it("returns null on provider failure", async () => {
    (storage.getLlmProvider as vi.Mock).mockResolvedValue(null);
    const title = await chatTitleGeneratorService.generateTitleForChat({
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      firstMessageText: "Let's talk later.",
    });
    expect(title).toBeNull();
  });

  it("returns null when LLM throws", async () => {
    (executeLlmCompletion as vi.Mock).mockRejectedValue(new Error("LLM unavailable"));
    const title = await chatTitleGeneratorService.generateTitleForChat({
      workspaceId: "ws-1",
      userId: "user-1",
      chatId: "chat-1",
      firstMessageText: "Tell me about AI",
    });
    expect(title).toBeNull();
  });
});

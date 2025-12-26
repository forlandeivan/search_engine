import { describe, expect, it } from "vitest";
import { buildChatCompletionRequestBody, type ChatLlmContext } from "../server/chat-service";

describe("buildChatCompletionRequestBody with retrieved context", () => {
  const baseContext: ChatLlmContext = {
    chat: {} as any,
    skill: { id: "s", name: "Skill", isSystem: false, systemKey: null, type: "LLM_SKILL", isUnicaChat: false, isRagSkill: false, mode: "llm" },
    skillConfig: {} as any,
    provider: {
      id: "p1",
      name: "Provider",
      providerType: "openai",
      requestConfig: { messagesField: "messages", modelField: "model" },
      isActive: true,
    } as any,
    requestConfig: { messagesField: "messages", modelField: "model" },
    model: "gpt",
    modelInfo: null,
    messages: [
      { role: "user", content: "Hello" },
    ],
    contextInputLimit: null,
  };

  it("вставляет системное сообщение с контекстом", () => {
    const context: ChatLlmContext = {
      ...baseContext,
      retrievedContext: ["fact1", "fact2"],
    };
    const body = buildChatCompletionRequestBody(context);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Контекст из документов навыка");
    expect(messages[0].content).toContain("fact1");
    expect(messages[1].role).toBe("user");
  });

  it("не вставляет контекст, если его нет", () => {
    const body = buildChatCompletionRequestBody(baseContext);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("user");
  });
});

import { describe, expect, it } from "vitest";
import { resolveAssistantActionVisibility } from "../client/src/lib/assistantAction";
import type { AssistantActionState, ChatMessage } from "../client/src/types/chat";

const action: AssistantActionState = {
  type: "ANALYZING",
  text: null,
  triggerMessageId: "user-1",
  updatedAt: null,
};

const baseMessage = (override: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  chatId: "chat-1",
  role: "assistant",
  content: "Привет",
  createdAt: new Date().toISOString(),
  metadata: {},
  ...override,
});

describe("resolveAssistantActionVisibility", () => {
  it("hides action when message with matching trigger arrives", () => {
    const messages = [
      baseMessage({ metadata: { triggerMessageId: "user-1" } }),
    ];
    expect(resolveAssistantActionVisibility(action, messages)).toBeNull();
  });

  it("keeps action when no matching messages", () => {
    const messages = [baseMessage({ metadata: { triggerMessageId: "other" } })];
    expect(resolveAssistantActionVisibility(action, messages)).toEqual(action);
  });

  it("hides action without trigger when any assistant message exists", () => {
    const actionWithoutTrigger: AssistantActionState = { ...action, triggerMessageId: null };
    const messages = [baseMessage({ metadata: {} })];
    expect(resolveAssistantActionVisibility(actionWithoutTrigger, messages)).toBeNull();
  });
});

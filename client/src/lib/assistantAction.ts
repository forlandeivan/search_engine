import type { AssistantActionState, ChatMessage } from "@/types/chat";

export function resolveAssistantActionVisibility(
  action: AssistantActionState | null | undefined,
  messages: ChatMessage[],
): AssistantActionState | null {
  if (!action) return null;
  const trigger = action.triggerMessageId?.trim();
  const hasResultForTrigger = messages.some((message) => {
    const isResultRole = message.role === "assistant" || message.role === "system";
    const metaTrigger = (message.metadata as Record<string, unknown> | undefined)?.triggerMessageId;
    if (trigger) {
      return isResultRole && typeof metaTrigger === "string" && metaTrigger.trim() === trigger;
    }
    return isResultRole;
  });

  if (hasResultForTrigger) {
    return null;
  }
  return action ?? null;
}

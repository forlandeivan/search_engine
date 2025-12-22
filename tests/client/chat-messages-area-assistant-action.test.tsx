/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ChatMessagesArea from "@/components/chat/ChatMessagesArea";

describe("ChatMessagesArea assistant action indicator", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: () => {},
      writable: true,
    });
  });

  const baseMessage = {
    id: "msg-1",
    chatId: "chat-1",
    role: "user" as const,
    content: "Привет",
    createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    metadata: {},
  };

  it("renders custom action text from assistantAction", () => {
    const { getByText, queryByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[baseMessage]}
        assistantAction={{
          type: "ANALYZING",
          text: "Готовлю ответ",
          triggerMessageId: null,
          updatedAt: null,
        }}
        isLoading={false}
        isNewChat={false}
        isStreaming={false}
        isTranscribing={false}
        streamError={null}
        errorMessage={null}
      />,
    );

    expect(getByText("Готовлю ответ")).toBeTruthy();
    expect(queryByText("Ассистент печатает...")).toBeNull();
  });

  it("renders default text for known action type", () => {
    const { getByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[baseMessage]}
        assistantAction={{
          type: "TRANSCRIBING",
          text: null,
          triggerMessageId: null,
          updatedAt: null,
        }}
        isLoading={false}
        isNewChat={false}
        isStreaming={true}
        isTranscribing={false}
        streamError={null}
        errorMessage={null}
      />,
    );

    expect(getByText("Готовит стенограмму...")).toBeTruthy();
  });
});

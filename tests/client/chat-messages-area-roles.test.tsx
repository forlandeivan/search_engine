/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ChatMessagesArea from "@/components/chat/ChatMessagesArea";

describe("ChatMessagesArea roles", () => {
  it("renders user/assistant/system messages without crashing", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: () => {},
      writable: true,
    });

    const { getByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[
          {
            id: "m1",
            chatId: "chat-1",
            role: "user",
            content: "Привет",
            createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
            metadata: {},
          },
          {
            id: "m2",
            chatId: "chat-1",
            role: "assistant",
            content: "Ответ ассистента",
            createdAt: new Date("2025-01-01T00:00:01.000Z").toISOString(),
            metadata: {},
          },
          {
            id: "m3",
            chatId: "chat-1",
            role: "system",
            content: "Системное сообщение",
            createdAt: new Date("2025-01-01T00:00:02.000Z").toISOString(),
            metadata: {},
          },
        ]}
        isLoading={false}
        isNewChat={false}
        isStreaming={false}
        isTranscribing={false}
        streamError={null}
        errorMessage={null}
      />,
    );

    expect(getByText("Привет")).toBeTruthy();
    expect(getByText("Ответ ассистента")).toBeTruthy();
    expect(getByText("Системное сообщение")).toBeTruthy();
  });
});

/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";

import ChatMessagesArea from "@/components/chat/ChatMessagesArea";

describe("ChatMessagesArea streaming indicator", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: () => {},
      writable: true,
    });
  });

  it("shows spinner text for streaming message from metadata", () => {
    const { getByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[
          {
            id: "m1",
            chatId: "chat-1",
            role: "assistant",
            content: "Прив",
            createdAt: new Date().toISOString(),
            metadata: { streaming: true, streamId: "s1" },
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

    expect(getByText("Ассистент печатает...")).toBeTruthy();
  });
});

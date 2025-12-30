/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ChatMessagesArea from "@/components/chat/ChatMessagesArea";

describe("ChatMessagesArea transcript placeholder handling", () => {
  const baseMessage = {
    id: "msg-1",
    chatId: "chat-1",
    role: "assistant" as const,
    content: "",
    createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    metadata: {
      type: "transcript",
      transcriptId: "t-1",
      transcriptStatus: "processing",
    },
  };

  it("does not render processing transcript placeholder bubble", () => {
    const { queryByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[baseMessage]}
        assistantAction={null}
        isReadOnly={false}
        isLoading={false}
        isNewChat={false}
        isStreaming={false}
        streamError={null}
        errorMessage={null}
      />,
    );

    expect(queryByText("Транскрипция аудиофайла")).toBeNull();
    expect(queryByText("Подождите, готовим стенограмму")).toBeNull();
  });

  it("does not render postprocessing transcript placeholder bubble", () => {
    const postprocessingMessage = {
      ...baseMessage,
      metadata: {
        type: "transcript",
        transcriptId: "t-1",
        transcriptStatus: "postprocessing",
      },
    };

    const { queryByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[postprocessingMessage]}
        assistantAction={null}
        isReadOnly={false}
        isLoading={false}
        isNewChat={false}
        isStreaming={false}
        streamError={null}
        errorMessage={null}
      />,
    );

    expect(queryByText("Транскрипция аудиофайла")).toBeNull();
    expect(queryByText("Подождите, готовим стенограмму")).toBeNull();
  });

  it("renders ready transcript card (not filtered)", () => {
    const readyMessage = {
      ...baseMessage,
      content: "Preview text",
      metadata: {
        type: "transcript",
        transcriptId: "t-1",
        transcriptStatus: "ready",
        previewText: "Preview text",
      },
    };

    const { getByText } = render(
      <ChatMessagesArea
        chatTitle="Чат"
        skillName="Навык"
        chatId="chat-1"
        messages={[readyMessage]}
        assistantAction={null}
        isReadOnly={false}
        isLoading={false}
        isNewChat={false}
        isStreaming={false}
        streamError={null}
        errorMessage={null}
      />,
    );

    // Готовая транскрипция должна показываться
    expect(getByText("Транскрипция аудиофайла")).toBeTruthy();
    expect(getByText("Preview text")).toBeTruthy();
  });
});

/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BotActionIndicatorRow } from "@/components/chat/BotActionIndicatorRow";
import type { BotAction } from "@shared/schema";

const baseAction: BotAction = {
  workspaceId: "ws",
  chatId: "chat",
  actionId: "act",
  actionType: "transcribe_audio",
  status: "processing",
  displayText: "Готовим стенограмму…",
};

describe("BotActionIndicatorRow", () => {
  it("renders text when visible", () => {
    render(<BotActionIndicatorRow action={baseAction} />);
    expect(screen.getByTestId("bot-action-indicator-row")).toBeTruthy();
    expect(screen.getByText("Готовим стенограмму…")).toBeTruthy();
  });

  it("shows spinner for processing status", () => {
    const { container } = render(
      <BotActionIndicatorRow action={baseAction} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("hides when not visible", () => {
    const { queryByTestId } = render(
      <BotActionIndicatorRow action={null} />,
    );
    expect(queryByTestId("bot-action-indicator-row")).toBeNull();
  });
});

/* @vitest-environment jsdom */

import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toasts: [],
    toast: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import ChatInput from "@/components/chat/ChatInput";
import { TooltipProvider } from "@/components/ui/tooltip";

const renderWithTooltip = (props: Parameters<typeof ChatInput>[0]) =>
  render(
    <TooltipProvider>
      <ChatInput {...props} />
    </TooltipProvider>,
  );

const windowRejectionHandler = (event: PromiseRejectionEvent) => {
  event.preventDefault();
  event.stopImmediatePropagation?.();
};

const processRejectionHandler = () => {
  // noop: prevent Vitest from failing on handled rejection below
};

beforeAll(() => {
  window.addEventListener("unhandledrejection", windowRejectionHandler);
  process.on("unhandledRejection", processRejectionHandler);
});

afterAll(() => {
  window.removeEventListener("unhandledrejection", windowRejectionHandler);
  process.removeListener("unhandledRejection", processRejectionHandler);
});

describe("ChatInput", () => {
  it("disables controls when read-only", () => {
    const { getByTestId } = renderWithTooltip({
      onSend: vi.fn(),
      disabled: true,
      readOnlyHint: "Чат архивирован",
      showAudioAttach: false,
    });

    const textarea = getByTestId("input-chat-message");
    const sendButton = getByTestId("button-send-message");

    expect(textarea.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
  });

  it("retains message when sending fails", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("boom"));
    const { getByTestId } = renderWithTooltip({
      onSend,
      showAudioAttach: false,
    });

    const textarea = getByTestId("input-chat-message");
    const sendButton = getByTestId("button-send-message");

    fireEvent.change(textarea, { target: { value: "  hello  " } });
    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("hello");
    });
    expect(textarea.value).toBe("  hello  ");
  });
});

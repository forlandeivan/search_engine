/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LlmExecutionDetailsPanel } from "@/components/llm-executions/LlmExecutionDetailsPanel";

const mockUseLlmExecutionDetails = vi.fn();

vi.mock("@/hooks/useLlmExecutions", () => ({
  useLlmExecutionDetails: (executionId: string | null, options?: unknown) =>
    mockUseLlmExecutionDetails(executionId, options),
}));

const sampleSummary = {
  execution: {
    id: "exec-1",
    workspaceId: "ws-1",
    workspaceName: "Demo Workspace",
    userId: "user-1",
    userEmail: "user@example.com",
    userName: "Demo User",
    skillId: "skill-1",
    skillName: "Demo Skill",
    skillIsSystem: false,
    chatId: "chat-1",
    status: "success",
    hasError: true,
    source: "workspace_skill",
    startedAt: new Date().toISOString(),
    finishedAt: new Date(Date.now() + 5000).toISOString(),
    durationMs: 5000,
    userMessageId: "msg-1",
    userMessagePreview: "Привет!",
    metadata: null,
  },
  steps: [],
};

describe("LlmExecutionDetailsPanel", () => {
  beforeEach(() => {
    mockUseLlmExecutionDetails.mockReset();
  });

  it("renders placeholder when no execution selected", () => {
    render(<LlmExecutionDetailsPanel onClose={() => {}} />);
    expect(screen.getByText(/Выберите запуск/i)).toBeTruthy();
  });

  it("renders summary information when data loaded", () => {
    mockUseLlmExecutionDetails.mockReturnValue({
      execution: sampleSummary,
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<LlmExecutionDetailsPanel executionId="exec-1" onClose={() => {}} />);

    expect(screen.getByText("Успешно")).toBeTruthy();
    expect(screen.getByText(/Есть ошибки/i)).toBeTruthy();
    expect(screen.getByText("Demo Workspace")).toBeTruthy();
    expect(screen.getByText("Demo User")).toBeTruthy();
  });

  it("renders error state for missing execution", () => {
    mockUseLlmExecutionDetails.mockReturnValue({
      execution: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Not Found"),
    });
    render(<LlmExecutionDetailsPanel executionId="exec-404" onClose={() => {}} />);

    expect(screen.getByText(/Запуск не найден/i)).toBeTruthy();
  });
});

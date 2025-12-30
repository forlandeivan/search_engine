/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("bot-action-watchdog", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("expires stuck processing actions older than cutoff", async () => {
    const mockExpireStuckBotActions = vi.fn();
    const mockEmitBotAction = vi.fn();

    vi.doMock("../server/storage", () => ({
      storage: {
        expireStuckBotActions: mockExpireStuckBotActions,
      },
    }));

    vi.doMock("../server/chat-events", () => ({
      emitBotAction: mockEmitBotAction,
    }));

    const expiredActions = [
      {
        workspaceId: "ws1",
        chatId: "chat1",
        actionId: "action1",
        actionType: "transcribe_audio",
        status: "error",
        payload: { reason: "timeout" },
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    ];

    mockExpireStuckBotActions.mockResolvedValue(expiredActions);

    const { runBotActionWatchdog } = await import("../server/bot-action-watchdog");
    const result = await runBotActionWatchdog({ maxProcessingHours: 2, checkIntervalMinutes: 30 });

    expect(result.expired).toBe(1);
    expect(mockExpireStuckBotActions).toHaveBeenCalledOnce();
    expect(mockEmitBotAction).toHaveBeenCalledWith("chat1", expiredActions[0]);
  });

  it("does not emit events when no actions expired", async () => {
    const mockExpireStuckBotActions = vi.fn();
    const mockEmitBotAction = vi.fn();

    vi.doMock("../server/storage", () => ({
      storage: {
        expireStuckBotActions: mockExpireStuckBotActions,
      },
    }));

    vi.doMock("../server/chat-events", () => ({
      emitBotAction: mockEmitBotAction,
    }));

    mockExpireStuckBotActions.mockResolvedValue([]);

    const { runBotActionWatchdog } = await import("../server/bot-action-watchdog");
    const result = await runBotActionWatchdog({ maxProcessingHours: 2, checkIntervalMinutes: 30 });

    expect(result.expired).toBe(0);
    expect(mockExpireStuckBotActions).toHaveBeenCalledOnce();
    expect(mockEmitBotAction).not.toHaveBeenCalled();
  });

  it("handles errors gracefully", async () => {
    const mockExpireStuckBotActions = vi.fn();
    const mockEmitBotAction = vi.fn();

    vi.doMock("../server/storage", () => ({
      storage: {
        expireStuckBotActions: mockExpireStuckBotActions,
      },
    }));

    vi.doMock("../server/chat-events", () => ({
      emitBotAction: mockEmitBotAction,
    }));

    mockExpireStuckBotActions.mockRejectedValue(new Error("Database error"));

    const { runBotActionWatchdog } = await import("../server/bot-action-watchdog");
    const result = await runBotActionWatchdog({ maxProcessingHours: 2, checkIntervalMinutes: 30 });

    expect(result.expired).toBe(0);
    expect(mockEmitBotAction).not.toHaveBeenCalled();
  });
});

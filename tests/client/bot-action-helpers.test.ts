/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { resolveBotActionText, getBotActionDefaultTextMap, computeCurrentAction, countOtherActiveActions } from "@/lib/botAction";
import type { BotAction } from "@shared/schema";
import { botActionTypes } from "@shared/schema";

const baseAction: BotAction = {
  workspaceId: "ws",
  chatId: "chat",
  actionId: "a1",
  actionType: "transcribe_audio",
  status: "processing",
};

describe("botAction helpers", () => {
  it("uses displayText when provided", () => {
    const text = resolveBotActionText({ ...baseAction, displayText: "Кастом" });
    expect(text).toBe("Кастом");
  });

  it("uses default text for known actionType", () => {
    const text = resolveBotActionText(baseAction);
    expect(text).toBe(getBotActionDefaultTextMap().transcribe_audio);
  });

  it("falls back for unknown actionType", () => {
    const text = resolveBotActionText({ ...baseAction, actionType: "unknown_action" });
    expect(text).toBe("Выполняем действие…");
  });

  it("returns null when no action", () => {
    expect(resolveBotActionText(null)).toBeNull();
  });

  it("default map contains all known botActionTypes", () => {
    const map = getBotActionDefaultTextMap();
    botActionTypes.forEach((type) => {
      expect(map[type]).toBeTruthy();
    });
  });
});

describe("computeCurrentAction", () => {
  const chatId = "chat-1";
  const baseTime = new Date("2024-01-01T10:00:00Z").getTime();

  it("returns null when no active actions", () => {
    const actions: BotAction[] = [];
    expect(computeCurrentAction(actions, chatId)).toBeNull();
  });

  it("returns null when no processing actions", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "done",
        updatedAt: new Date(baseTime).toISOString(),
      },
    ];
    expect(computeCurrentAction(actions, chatId)).toBeNull();
  });

  it("returns the action with latest updatedAt", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "processing",
        updatedAt: new Date(baseTime).toISOString(),
      },
      {
        ...baseAction,
        actionId: "a2",
        status: "processing",
        updatedAt: new Date(baseTime + 1000).toISOString(), // новее
      },
    ];
    const current = computeCurrentAction(actions, chatId);
    expect(current?.actionId).toBe("a2");
  });

  it("falls back to createdAt when updatedAt is missing", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "processing",
        createdAt: new Date(baseTime).toISOString(),
      },
      {
        ...baseAction,
        actionId: "a2",
        status: "processing",
        createdAt: new Date(baseTime + 1000).toISOString(),
      },
    ];
    const current = computeCurrentAction(actions, chatId);
    expect(current?.actionId).toBe("a2");
  });

  it("filters by chatId", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        chatId: "chat-1",
        actionId: "a1",
        status: "processing",
        updatedAt: new Date(baseTime).toISOString(),
      },
      {
        ...baseAction,
        chatId: "chat-2",
        actionId: "a2",
        status: "processing",
        updatedAt: new Date(baseTime + 1000).toISOString(),
      },
    ];
    const current = computeCurrentAction(actions, "chat-1");
    expect(current?.actionId).toBe("a1");
  });

  it("handles multiple processing actions correctly", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "processing",
        updatedAt: new Date(baseTime).toISOString(),
      },
      {
        ...baseAction,
        actionId: "a2",
        status: "processing",
        updatedAt: new Date(baseTime + 2000).toISOString(), // самый новый
      },
      {
        ...baseAction,
        actionId: "a3",
        status: "processing",
        updatedAt: new Date(baseTime + 1000).toISOString(),
      },
    ];
    const current = computeCurrentAction(actions, chatId);
    expect(current?.actionId).toBe("a2");
  });
});

describe("countOtherActiveActions", () => {
  const chatId = "chat-1";

  it("returns 0 when no other active actions", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "processing",
      },
    ];
    expect(countOtherActiveActions(actions, chatId, "a1")).toBe(0);
  });

  it("returns count of other processing actions", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "processing",
      },
      {
        ...baseAction,
        actionId: "a2",
        status: "processing",
      },
      {
        ...baseAction,
        actionId: "a3",
        status: "processing",
      },
    ];
    expect(countOtherActiveActions(actions, chatId, "a1")).toBe(2);
  });

  it("excludes done/error actions", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        actionId: "a1",
        status: "processing",
      },
      {
        ...baseAction,
        actionId: "a2",
        status: "done",
      },
      {
        ...baseAction,
        actionId: "a3",
        status: "processing",
      },
    ];
    expect(countOtherActiveActions(actions, chatId, "a1")).toBe(1);
  });

  it("filters by chatId", () => {
    const actions: BotAction[] = [
      {
        ...baseAction,
        chatId: "chat-1",
        actionId: "a1",
        status: "processing",
      },
      {
        ...baseAction,
        chatId: "chat-2",
        actionId: "a2",
        status: "processing",
      },
    ];
    expect(countOtherActiveActions(actions, "chat-1", "a1")).toBe(0);
  });
});

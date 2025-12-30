/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { resolveBotActionText, getBotActionDefaultTextMap } from "@/lib/botAction";
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

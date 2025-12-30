import { describe, expect, it } from "vitest";
import { botActionSchema, botActionTypes, botActionStatuses } from "@shared/schema";

describe("botActionSchema", () => {
  it("validates a correct bot action", () => {
    const sample = {
      workspaceId: "ws",
      chatId: "chat",
      actionId: "action-1",
      actionType: botActionTypes[0],
      status: botActionStatuses[0],
      displayText: "Текст",
    };
    expect(botActionSchema.parse(sample)).toBeTruthy();
  });

  it("rejects missing required fields", () => {
    const result = botActionSchema.safeParse({ workspaceId: "", chatId: "" });
    expect(result.success).toBe(false);
  });

  it("allows unknown actionType string", () => {
    const sample = {
      workspaceId: "ws",
      chatId: "chat",
      actionId: "action-2",
      actionType: "new_action_type",
      status: "processing",
    };
    const result = botActionSchema.safeParse(sample);
    expect(result.success).toBe(true);
  });
});

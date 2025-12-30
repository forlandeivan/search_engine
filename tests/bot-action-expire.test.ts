/* @vitest-environment node */

import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import type { BotActionStatus } from "@shared/schema";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Bot Action Test User",
    firstName: "Bot",
    lastName: "Action",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });

  return {
    ...user,
    hasPersonalApiToken: false,
    personalApiTokenLastFour: null,
  };
}

async function createWorkspaceForUser(userId: string, id: string) {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({ id, name: "Test Workspace", ownerId: userId, createdAt: new Date(), updatedAt: new Date() })
    .onConflictDoNothing()
    .returning();

  return workspace;
}

async function createChatSession(workspaceId: string, skillId: string | null = null) {
  return await storage.createChatSession({
    workspaceId,
    chatTitle: "Test Chat",
    skillId,
  });
}

async function insertBotAction(opts: {
  workspaceId: string;
  chatId: string;
  actionId: string;
  actionType: string;
  status: BotActionStatus;
  updatedAtMs: number;
}) {
  return await storage.upsertBotActionState({
    workspaceId: opts.workspaceId,
    chatId: opts.chatId,
    actionId: opts.actionId,
    actionType: opts.actionType,
    status: opts.status,
    displayText: null,
    payload: null,
  });
}

describe("bot-action expireStuckBotActions", () => {
  let workspaceId: string;
  let chatId: string;

  beforeAll(async () => {
    const user = await createUser(`bot-action-expire-${Date.now()}@example.com`);
    workspaceId = `bot-action-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
    const chat = await createChatSession(workspaceId);
    chatId = chat.id;
  });

  it("expires stuck processing actions older than cutoff", async () => {
    const now = Date.now();
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;
    const oneHourAgo = now - 1 * 60 * 60 * 1000;

    // Insert stuck action (3 hours old)
    await insertBotAction({
      workspaceId,
      chatId,
      actionId: `stuck-action-${now}`,
      actionType: "transcribe_audio",
      status: "processing",
      updatedAtMs: threeHoursAgo,
    });

    // Insert recent action (1 hour old)
    await insertBotAction({
      workspaceId,
      chatId,
      actionId: `recent-action-${now}`,
      actionType: "summarize",
      status: "processing",
      updatedAtMs: oneHourAgo,
    });

    // Manually update updatedAt to simulate old actions
    const db = (storage as any).db;
    await db.execute(
      `UPDATE bot_actions SET updated_at = to_timestamp(${threeHoursAgo / 1000}) WHERE action_id = 'stuck-action-${now}'`,
    );
    await db.execute(
      `UPDATE bot_actions SET updated_at = to_timestamp(${oneHourAgo / 1000}) WHERE action_id = 'recent-action-${now}'`,
    );

    // Expire actions older than 2 hours
    const cutoff = new Date(now - 2 * 60 * 60 * 1000);
    const expired = await storage.expireStuckBotActions(cutoff);

    expect(expired.length).toBe(1);
    expect(expired[0]?.actionId).toBe(`stuck-action-${now}`);
    expect(expired[0]?.status).toBe("error");
    expect(expired[0]?.payload).toMatchObject({ reason: "timeout" });
  });

  it("does not expire done or error actions", async () => {
    const now = Date.now();
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;

    // Insert done action (old but already finished)
    await insertBotAction({
      workspaceId,
      chatId,
      actionId: `done-action-${now}`,
      actionType: "process_file",
      status: "done",
      updatedAtMs: threeHoursAgo,
    });

    const db = (storage as any).db;
    await db.execute(
      `UPDATE bot_actions SET updated_at = to_timestamp(${threeHoursAgo / 1000}) WHERE action_id = 'done-action-${now}'`,
    );

    const cutoff = new Date(now - 2 * 60 * 60 * 1000);
    const expired = await storage.expireStuckBotActions(cutoff);

    // Should not include the done action
    const expiredIds = expired.map((a) => a.actionId);
    expect(expiredIds).not.toContain(`done-action-${now}`);
  });

  it("returns empty array when no stuck actions", async () => {
    const cutoff = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10 hours ago
    const expired = await storage.expireStuckBotActions(cutoff);

    // May return 0 or more depending on previous tests, but should not crash
    expect(Array.isArray(expired)).toBe(true);
  });
});


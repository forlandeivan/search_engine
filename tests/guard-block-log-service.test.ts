import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { db } from "../server/db";
import { guardBlockEvents, workspaces } from "@shared/schema";
import { logGuardBlockEvent, listGuardBlockEvents } from "../server/guards/block-log-service";
import { mapDecisionToPayload, OperationBlockedError } from "../server/guards/errors";
import type { OperationContext } from "../server/guards/types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  return storage.createUser({
    email,
    fullName: "Guard Block User",
    firstName: "Guard",
    lastName: "User",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });
}

async function createWorkspaceForUser(userId: string, id: string, name = "Guard Block Workspace") {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id,
      name,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("guard block log service", () => {
  const workspaceId = `guard-ws-${Date.now()}`;
  let userId: string;

  beforeAll(async () => {
    const user = await createUser(`guard-block-${Date.now()}@example.com`);
    userId = user.id;
    await createWorkspaceForUser(userId, workspaceId);
  });

  afterAll(async () => {
    await db.delete(guardBlockEvents).where(eq(guardBlockEvents.workspaceId, workspaceId));
  });

  it("persists deny event and aligns with OperationBlockedError payload", async () => {
    const decision = {
      allowed: false,
      reasonCode: "USAGE_LIMIT_REACHED",
      resourceType: "tokens" as const,
      message: "Достигнут лимит токенов",
      upgradeAvailable: true,
    };

    const context: OperationContext = {
      workspaceId,
      operationType: "LLM_REQUEST",
      expectedCost: { tokens: 256 },
      meta: {
        llm: { provider: "test-llm", model: "gpt-test", scenario: "chat" },
        objects: { entityType: "skill" },
      },
    };

    const snapshot = {
      workspaceId,
      periodCode: "2025-12",
      llmTokensTotal: 123,
      embeddingsTokensTotal: 0,
      asrMinutesTotal: 0,
      storageBytesTotal: 0,
      skillsCount: 0,
      actionsCount: 0,
      knowledgeBasesCount: 0,
      membersCount: 1,
    };

    const logged = await logGuardBlockEvent(decision, context, snapshot as any, "req-guard-log", {
      actorType: "user",
      actorId: userId,
    });

    expect(logged?.workspaceId).toBe(workspaceId);
    expect(logged?.reasonCode).toBe(decision.reasonCode);
    expect(logged?.resourceType).toBe(decision.resourceType);
    expect(logged?.upgradeAvailable).toBe(true);
    expect(logged?.expectedCost).toMatchObject({ tokens: 256 });

    const payload = mapDecisionToPayload(decision, context);
    const error = new OperationBlockedError(payload);

    expect(error.payload.reasonCode).toBe(logged?.reasonCode);
    expect(error.payload.resourceType).toBe(logged?.resourceType);
    expect(error.payload.message).toBe(logged?.message);

    const { items, total } = await listGuardBlockEvents({ workspaceId, limit: 5 });
    expect(total).toBeGreaterThan(0);
    const found = items.find((item) => item.id === logged?.id);
    expect(found?.workspaceName).toContain("Guard");
    expect(found?.operationType).toBe(context.operationType);
  });
});

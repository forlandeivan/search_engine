import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../server/db";
import { tariffLimitRulesProvider } from "../server/guards/limit-rules-provider";
import { tariffLimits, tariffPlans, users, workspaces } from "@shared/schema";
import { sql } from "drizzle-orm";

async function createPlanWithLimit(limitKey: string, limitValue: number | null, isEnabled = true) {
  const [plan] = await db
    .insert(tariffPlans)
    .values({
      code: `PLAN-${Date.now()}`,
      name: "Test plan",
      description: "Test",
      isActive: true,
    })
    .returning();

  await db
    .insert(tariffLimits)
    .values({
      planId: plan.id,
      limitKey,
      unit: "count",
      limitValue,
      isEnabled,
    })
    .onConflictDoNothing();

  return plan;
}

async function createWorkspace(planId: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `tariff-provider-${Date.now()}@example.com`,
      passwordHash: "hash",
      isEmailConfirmed: true,
      firstName: "Tariff",
      lastName: "User",
      fullName: "Tariff User",
    })
    .returning();

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Tariff test WS",
      ownerId: user!.id,
      tariffPlanId: planId,
      plan: "free",
    })
    .returning();

  return workspace!;
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM users WHERE email LIKE 'tariff-provider-%'`);
  await db.execute(sql`DELETE FROM tariff_plans WHERE code LIKE 'PLAN-%'`);
});

describe("TariffLimitRulesProvider", () => {
  it("returns enabled tariff limits mapped to rules", async () => {
    const plan = await createPlanWithLimit("TOKEN_LLM", 1000, true);
    const workspace = await createWorkspace(plan.id);

    const rules = await tariffLimitRulesProvider.getRules(workspace.id, {
      workspaceId: workspace.id,
      operationType: "LLM_REQUEST",
    });

    expect(rules.length).toBe(1);
    expect(rules[0]).toMatchObject({
      limitKey: "TOKEN_LLM",
      limitValue: 1000,
      resourceType: "tokens",
      appliesTo: { operationType: "LLM_REQUEST" },
    });
  });

  it("skips disabled limits", async () => {
    const plan = await createPlanWithLimit("STORAGE_BYTES", 10, false);
    const workspace = await createWorkspace(plan.id);

    const rules = await tariffLimitRulesProvider.getRules(workspace.id, {
      workspaceId: workspace.id,
      operationType: "STORAGE_UPLOAD",
    });

    expect(rules).toHaveLength(0);
  });
});

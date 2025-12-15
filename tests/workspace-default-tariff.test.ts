import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { tariffPlans, users, workspaces, workspaceMembers } from "@shared/schema";
import { tariffPlanService } from "../server/tariff-plan-service";

async function ensureFreePlan() {
  const existing = await tariffPlanService.getPlanByCode("FREE");
  if (existing) return existing;

  const [inserted] = await storage.db
    .insert(tariffPlans)
    .values({
      code: "FREE",
      name: "Free",
      description: "Default free plan",
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  return inserted ?? (await tariffPlanService.getPlanByCode("FREE"))!;
}

async function createUser() {
  const [user] = await storage.db
    .insert(users)
    .values({
      email: `tariff-free-${Date.now()}@example.com`,
      passwordHash: "hash",
      isEmailConfirmed: true,
      firstName: "Free",
      lastName: "Plan",
      fullName: "Free Plan",
    })
    .returning();
  return user!;
}

beforeEach(async () => {
  await storage.db.execute(sql`DELETE FROM ${workspaceMembers}`);
  await storage.db.execute(sql`DELETE FROM ${workspaces}`);
  await storage.db.execute(sql`DELETE FROM ${users} WHERE email LIKE 'tariff-free-%'`);
});

describe("Workspace default tariff", () => {
  it("assigns FREE tariff plan when creating personal workspace", async () => {
    const freePlan = await ensureFreePlan();
    const user = await createUser();

    const workspace = await storage.ensurePersonalWorkspace(user);

    expect(workspace.tariffPlanId).toBe(freePlan.id);
    expect(workspace.plan).toBe("free");
  });
});

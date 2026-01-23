import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { tariffPlans, users, workspaceCreditAccounts } from "@shared/schema";
import { tariffPlanService } from "../server/tariff-plan-service";

const TEST_FREE_PLAN_CREDITS = 5000; // 50.00 кредитов в центах

async function ensureFreePlan() {
  const existing = await tariffPlanService.getPlanByCode("FREE");
  if (existing) {
    // Обновляем кредиты для теста, если они отличаются
    if (existing.includedCreditsAmount !== TEST_FREE_PLAN_CREDITS) {
      await storage.db
        .update(tariffPlans)
        .set({ includedCreditsAmount: TEST_FREE_PLAN_CREDITS })
        .where(eq(tariffPlans.id, existing.id));
      return { ...existing, includedCreditsAmount: TEST_FREE_PLAN_CREDITS };
    }
    return existing;
  }

  const [inserted] = await storage.db
    .insert(tariffPlans)
    .values({
      code: "FREE",
      name: "Free",
      description: "Default free plan",
      isActive: true,
      includedCreditsAmount: TEST_FREE_PLAN_CREDITS,
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

  it("grants initial credits according to FREE plan when creating personal workspace", async () => {
    const freePlan = await ensureFreePlan();
    const user = await createUser();

    const workspace = await storage.ensurePersonalWorkspace(user);

    // Проверяем, что кредитный аккаунт создан с правильным балансом
    const [creditAccount] = await storage.db
      .select()
      .from(workspaceCreditAccounts)
      .where(eq(workspaceCreditAccounts.workspaceId, workspace.id));

    expect(creditAccount).toBeDefined();
    expect(creditAccount.currentBalance).toBe(TEST_FREE_PLAN_CREDITS);
  });
});

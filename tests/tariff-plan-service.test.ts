import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tariffPlanService } from "../server/tariff-plan-service";
import { db } from "../server/db";
import { tariffLimits, tariffPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

describe("TariffPlanService", () => {
  const runId = Date.now();
  const planId = `plan-${runId}`;
  const planCode = `TEST_PRO_${runId}`;

  beforeAll(async () => {
    await db.delete(tariffLimits).where(eq(tariffLimits.planId, planId));
    await db.delete(tariffPlans).where(eq(tariffPlans.code, planCode));

    await db.insert(tariffPlans).values({
      id: planId,
      code: planCode,
      name: "Pro",
      description: "Pro plan",
    });

    await db.insert(tariffLimits).values([
      {
        planId,
        limitKey: "OBJECT_SKILLS",
        unit: "count",
        limitValue: 1000000,
        isEnabled: true,
      },
      {
        planId,
        limitKey: "STORAGE_BYTES",
        unit: "bytes",
        limitValue: null,
        isEnabled: true,
      },
      {
        planId,
        limitKey: "UNKNOWN_KEY",
        unit: "count",
        limitValue: 10,
        isEnabled: true,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(tariffLimits).where(eq(tariffLimits.planId, planId));
    await db.delete(tariffPlans).where(eq(tariffPlans.code, planCode));
  });

  it("returns plan by code", async () => {
    const plan = await tariffPlanService.getPlanByCode(planCode);
    expect(plan?.id).toBe(planId);
    expect(plan?.code).toBe(planCode);
    expect(plan?.noCodeFlowEnabled).toBe(false);
  });

  it("returns plan with limits map and ignores unknown keys", async () => {
    const plan = await tariffPlanService.getPlanWithLimitsByCode(planCode);
    expect(plan).not.toBeNull();
    expect(plan?.limits.OBJECT_SKILLS?.value).toBe(1000000);
    expect(plan?.limits.STORAGE_BYTES?.value).toBeNull();
    expect(plan?.limits.STORAGE_BYTES?.isEnabled).toBe(true);
    expect(plan?.limits).not.toHaveProperty("UNKNOWN_KEY");
  });

  it("ensures unique plan_id + limit_key", async () => {
    await expect(
      db.insert(tariffLimits).values({
        planId,
        limitKey: "OBJECT_SKILLS",
        unit: "count",
        limitValue: 1,
        isEnabled: true,
      }),
    ).rejects.toThrow();

    const count = await db
      .select({ cnt: tariffLimits.id })
      .from(tariffLimits)
      .where(eq(tariffLimits.planId, planId));
    expect(count.length).toBeGreaterThan(0);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { seedDefaultTariffs, DEFAULT_TARIFFS } from "../server/tariff-seed";
import { tariffPlanService } from "../server/tariff-plan-service";

describe("tariff seed", () => {
  beforeAll(async () => {
    await seedDefaultTariffs();
  });

  it("creates default plans without duplicates", async () => {
    await seedDefaultTariffs();
    const plans = await tariffPlanService.getAllPlans();
    const codes = plans.map((p) => p.code).sort();
    expect(codes).toEqual(["ENTERPRISE", "FREE", "PRO"]);
  });

  it("fills all limit keys for FREE plan", async () => {
    const freePlan = await tariffPlanService.getPlanWithLimitsByCode("FREE");
    const keys = Object.keys(freePlan?.limits ?? {}).sort();
    const expectedKeys = DEFAULT_TARIFFS.find((p) => p.code === "FREE")!.limits.map((l) => l.key).sort();
    expect(keys).toEqual(expectedKeys);
  });
});

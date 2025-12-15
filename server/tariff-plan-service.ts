import { db } from "./db";
import { tariffLimits, tariffPlans, type TariffLimit, type TariffPlan } from "@shared/schema";
import { eq } from "drizzle-orm";
import { LIMIT_KEYS, type LimitKey } from "./guards/types";

export type TariffPlanLimitsMap = Record<
  LimitKey,
  {
    unit: string;
    value: number | null;
    isEnabled: boolean;
  }
>;

export type TariffPlanWithLimits = TariffPlan & { limits: TariffPlanLimitsMap };

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const LIMIT_KEY_SET = new Set<LimitKey>(LIMIT_KEYS);

function normalizeLimitKey(limitKey: string): LimitKey | null {
  const upper = limitKey.trim().toUpperCase();
  if (LIMIT_KEY_SET.has(upper as LimitKey)) {
    return upper as LimitKey;
  }
  console.warn("[tariff-plan-service] unknown limit_key, skipping", limitKey);
  return null;
}

function buildLimitsMap(limits: TariffLimit[]): TariffPlanLimitsMap {
  const result = {} as TariffPlanLimitsMap;
  for (const limit of limits) {
    const key = normalizeLimitKey(limit.limitKey);
    if (!key) continue;
    result[key] = {
      unit: limit.unit,
      value: limit.limitValue === undefined ? null : limit.limitValue,
      isEnabled: Boolean(limit.isEnabled),
    };
  }
  return result;
}

export class TariffPlanService {
  async getPlanByCode(code: string): Promise<TariffPlan | null> {
    const normalized = normalizeCode(code);
    const [plan] = await db.select().from(tariffPlans).where(eq(tariffPlans.code, normalized)).limit(1);
    return plan ?? null;
  }

  async getAllPlans(): Promise<TariffPlan[]> {
    const rows = await db.select().from(tariffPlans).orderBy(tariffPlans.code);
    return rows;
  }

  async getPlanLimits(planId: string): Promise<TariffLimit[]> {
    return db.select().from(tariffLimits).where(eq(tariffLimits.planId, planId));
  }

  async getPlanWithLimitsByCode(code: string): Promise<TariffPlanWithLimits | null> {
    const plan = await this.getPlanByCode(code);
    if (!plan) {
      return null;
    }
    const limits = await this.getPlanLimits(plan.id);
    return {
      ...plan,
      limits: buildLimitsMap(limits),
    };
  }
}

export const tariffPlanService = new TariffPlanService();

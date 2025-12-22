import { db } from "./db";
import { tariffLimits, tariffPlans, type TariffLimit, type TariffPlan } from "@shared/schema";
import { eq } from "drizzle-orm";
import { asc } from "drizzle-orm";
import { LIMIT_KEYS } from "./guards/types";

export type TariffPlanLimitsMap = Record<
  string,
  {
    unit: string;
    value: number | null;
    isEnabled: boolean;
  }
>;

export type TariffPlanWithLimits = TariffPlan & { limits: TariffPlanLimitsMap };
export type TariffCreditsConfig = {
  amount: number;
  period: "monthly";
};
export type TariffLimitInput = {
  limitKey: string;
  unit?: string | null;
  limitValue: number | null;
  isEnabled?: boolean;
};

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const LIMIT_KEY_SET = new Set<string>(LIMIT_KEYS);
const ALLOWED_UNITS = new Set(["tokens", "bytes", "minutes", "count"]);

function defaultUnitForKey(limitKey: string): string {
  switch (limitKey) {
    case "STORAGE_BYTES":
    case "QDRANT_BYTES":
      return "bytes";
    default:
      return "count";
  }
}

function normalizeLimitKey(limitKey: string): string | null {
  const upper = limitKey.trim().toUpperCase();
  if (upper.length === 0 || upper.length > 64) {
    console.warn("[tariff-plan-service] limit_key length invalid, skipping", limitKey);
    return null;
  }
  if (!/^[A-Z0-9_]+$/.test(upper)) {
    console.warn("[tariff-plan-service] limit_key format invalid, skipping", limitKey);
    return null;
  }

  if (LIMIT_KEY_SET.has(upper)) {
    return upper;
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
  // добавить отсутствующие ключи с дефолтными единицами и null-значением
  for (const key of LIMIT_KEYS) {
    if (result[key]) continue;
    result[key] = {
      unit: defaultUnitForKey(key),
      value: null,
      isEnabled: true,
    };
  }
  return result;
}

export class TariffPlanService {
  private resolveLimitKey(raw: string): string {
    const normalized = raw.trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,64}$/.test(normalized)) {
      throw new Error(`Invalid limitKey format: ${raw}`);
    }
    return normalized;
  }

  private resolveUnit(input: string | null | undefined, existingUnit?: string): string {
    const unit = input ?? existingUnit ?? null;
    const resolved = unit ?? undefined;
    const fallback = unit ?? existingUnit ?? null;
    const value = resolved ?? fallback ?? undefined;

    if (value && ALLOWED_UNITS.has(value)) {
      return value;
    }

    if (!value) {
      return "count";
    }

    throw new Error(`Invalid unit: ${value}`);
  }

  private normalizeLimitValue(value: number | null): number | null {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("limitValue must be a non-negative number or null");
    }
    return value;
  }

  private normalizeCreditsAmountCents(value: number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("includedCreditsAmount must be a non-negative number");
    }
    return Math.trunc(value);
  }

  private normalizeCreditsPeriod(value: string | null | undefined): "monthly" {
    if (!value || value.toLowerCase() === "monthly") return "monthly";
    throw new Error("includedCreditsPeriod must be 'monthly' in MVP");
  }

  async getPlanByCode(code: string): Promise<TariffPlan | null> {
    const normalized = normalizeCode(code);
    const [plan] = await db.select().from(tariffPlans).where(eq(tariffPlans.code, normalized)).limit(1);
    return plan ?? null;
  }

  async getPlanById(id: string): Promise<TariffPlan | null> {
    const [plan] = await db.select().from(tariffPlans).where(eq(tariffPlans.id, id)).limit(1);
    return plan ?? null;
  }

  async getAllPlans(): Promise<TariffPlan[]> {
    const rows = await db
      .select()
      .from(tariffPlans)
      .orderBy(asc(tariffPlans.sortOrder), asc(tariffPlans.code));
    return rows;
  }

  async getActivePlans(): Promise<TariffPlan[]> {
    const rows = await db
      .select()
      .from(tariffPlans)
      .where(eq(tariffPlans.isActive, true))
      .orderBy(asc(tariffPlans.sortOrder), asc(tariffPlans.code));
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

  async getPlanWithLimitsById(planId: string): Promise<TariffPlanWithLimits | null> {
    const plan = await this.getPlanById(planId);
    if (!plan) return null;
    const limits = await this.getPlanLimits(plan.id);
    return {
      ...plan,
      limits: buildLimitsMap(limits),
    };
  }

  async upsertPlanLimits(planId: string, limits: TariffLimitInput[], actorId?: string | null): Promise<TariffPlanWithLimits> {
    const plan = await this.getPlanById(planId);
    if (!plan) {
      throw new Error("Tariff plan not found");
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      const existing = await tx.select().from(tariffLimits).where(eq(tariffLimits.planId, planId));
      const existingMap = new Map(existing.map((l) => [l.limitKey, l]));

      for (const input of limits) {
        const normalizedKey = this.resolveLimitKey(input.limitKey);
        const previous = existingMap.get(normalizedKey);

        const unit = this.resolveUnit(input.unit ?? null, previous?.unit ?? defaultUnitForKey(normalizedKey));
        const limitValue = this.normalizeLimitValue(input.limitValue);
        const isEnabled = input.isEnabled ?? previous?.isEnabled ?? true;

        await tx
          .insert(tariffLimits)
          .values({
            planId,
            limitKey: normalizedKey,
            unit,
            limitValue,
            isEnabled,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [tariffLimits.planId, tariffLimits.limitKey],
            set: {
              unit,
              limitValue,
              isEnabled,
              updatedAt: now,
            },
          });

        console.info("[tariff-plan-service] limit upsert", {
          planId,
          limitKey: normalizedKey,
          unit,
          limitValue,
          isEnabled,
          actorId: actorId ?? null,
        });
      }
    });

    const updated = await this.getPlanWithLimitsById(planId);
    if (!updated) {
      throw new Error("Failed to reload plan after update");
    }
    return updated;
  }

  async updatePlanCredits(
    planId: string,
    payload: { amountCents?: number | null; period?: string | null; noCodeFlowEnabled?: boolean | null },
  ) {
    const plan = await this.getPlanById(planId);
    if (!plan) {
      throw new Error("Tariff plan not found");
    }

    const amount =
      payload.amountCents === undefined
        ? Number(plan.includedCreditsAmount ?? 0)
        : this.normalizeCreditsAmountCents(payload.amountCents);
    const period =
      payload.period === undefined
        ? this.normalizeCreditsPeriod(plan.includedCreditsPeriod ?? "monthly")
        : this.normalizeCreditsPeriod(payload.period ?? "monthly");
    const noCodeFlowEnabled =
      payload.noCodeFlowEnabled === undefined || payload.noCodeFlowEnabled === null
        ? Boolean(plan.noCodeFlowEnabled)
        : Boolean(payload.noCodeFlowEnabled);

    const [updated] = await db
      .update(tariffPlans)
      .set({
        includedCreditsAmount: amount,
        includedCreditsPeriod: period,
        noCodeFlowEnabled,
        updatedAt: new Date(),
      })
      .where(eq(tariffPlans.id, planId))
      .returning();

    if (!updated) {
      throw new Error("Failed to update tariff plan credits");
    }
    return updated;
  }
}

export const tariffPlanService = new TariffPlanService();

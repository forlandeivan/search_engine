import { db } from "./db";
import { workspaces } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { tariffPlanService, type TariffPlanWithLimits } from "./tariff-plan-service";
import { getWorkspaceUsageSnapshot, type UsageSnapshot } from "./usage/usage-service";
import type { LimitKey } from "./guards/types";
import { grantSubscriptionCreditsOnEvent } from "./credits-service";

type DowngradeViolation = {
  key: LimitKey;
  current: number;
  limit: number;
  message: string;
};

export class PlanDowngradeNotAllowedError extends Error {
  readonly code = "PLAN_DOWNGRADE_NOT_ALLOWED";
  constructor(
    public readonly violations: DowngradeViolation[],
    public readonly targetPlanCode: string,
  ) {
    super("Plan downgrade is not allowed");
  }
}

export class WorkspacePlanService {
  private async resolveWorkspace(workspaceId: string) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new Error("Workspace not found");
    return ws;
  }

  private async ensureTariffPlanId(workspaceId: string, currentPlanId: string | null): Promise<string> {
    if (currentPlanId) return currentPlanId;

    const fallback = await tariffPlanService.getPlanByCode("FREE");
    if (!fallback) throw new Error("Tariff plan not found");

    const [updated] = await db
      .update(workspaces)
      .set({ tariffPlanId: fallback.id })
      .where(eq(workspaces.id, workspaceId))
      .returning({ tariffPlanId: workspaces.tariffPlanId });

    return updated?.tariffPlanId ?? fallback.id;
  }

  async getWorkspacePlan(workspaceId: string) {
    const ws = await this.resolveWorkspace(workspaceId);
    const planId = await this.ensureTariffPlanId(workspaceId, ws.tariffPlanId ?? null);
    const plan = await tariffPlanService.getPlanById(planId);
    if (!plan) throw new Error("Tariff plan not found");
    return plan;
  }

  async getWorkspacePlanWithLimits(workspaceId: string): Promise<TariffPlanWithLimits> {
    const ws = await this.resolveWorkspace(workspaceId);
    const planId = await this.ensureTariffPlanId(workspaceId, ws.tariffPlanId ?? null);
    const plan = await tariffPlanService.getPlanWithLimitsById(planId);
    if (!plan) throw new Error("Tariff plan not found");
    return plan;
  }

  private isDowngrade(current: TariffPlanWithLimits, target: TariffPlanWithLimits): boolean {
    if (typeof current.sortOrder === "number" && typeof target.sortOrder === "number") {
      return target.sortOrder < current.sortOrder;
    }
    return false;
  }

  private getCurrentValue(key: LimitKey, snapshot: UsageSnapshot): number {
    switch (key) {
      case "STORAGE_BYTES":
        return snapshot.storageBytesTotal ?? 0;
      case "QDRANT_BYTES":
        return snapshot.qdrantStorageBytes ?? 0;
      case "OBJECT_SKILLS":
        return snapshot.skillsCount ?? 0;
      case "OBJECT_ACTIONS":
        return snapshot.actionsCount ?? 0;
      case "OBJECT_KNOWLEDGE_BASES":
        return snapshot.knowledgeBasesCount ?? 0;
      case "OBJECT_MEMBERS":
        return snapshot.membersCount ?? 0;
      default:
        return 0;
    }
  }

  private async validateDowngrade(
    workspaceId: string,
    currentPlan: TariffPlanWithLimits,
    targetPlan: TariffPlanWithLimits,
  ): Promise<void> {
    // Проверяем только основные лимиты, которые уже считаются и применяются guard'ами
    const LIMIT_KEYS_TO_VALIDATE: LimitKey[] = [
      "STORAGE_BYTES",
      "QDRANT_BYTES",
      "OBJECT_SKILLS",
      "OBJECT_ACTIONS",
      "OBJECT_KNOWLEDGE_BASES",
      "OBJECT_MEMBERS",
    ];

    const snapshot = await getWorkspaceUsageSnapshot(workspaceId);
    const violations: DowngradeViolation[] = [];

    for (const limitKey of LIMIT_KEYS_TO_VALIDATE) {
      const limitConfig = targetPlan.limits[limitKey];
      if (!limitConfig || limitConfig.value === null || limitConfig.isEnabled === false) {
        continue; // без лимита — не блокируем
      }

      const currentValue = this.getCurrentValue(limitKey, snapshot);
      if (currentValue > limitConfig.value) {
        violations.push({
          key: limitKey,
          current: currentValue,
          limit: limitConfig.value,
          message: `Лимит ${limitKey.toLowerCase()}: сейчас ${currentValue}, нужно ≤ ${limitConfig.value}`,
        });
      }
    }

    if (violations.length > 0) {
      throw new PlanDowngradeNotAllowedError(violations, targetPlan.code);
    }
  }

  async updateWorkspacePlan(workspaceId: string, planCode: string) {
    const targetPlan = await tariffPlanService.getPlanWithLimitsByCode(planCode);
    if (!targetPlan) throw new Error("Tariff plan not found");
    if (!targetPlan.isActive) throw new Error("Tariff plan is inactive");

    const currentPlan = await this.getWorkspacePlanWithLimits(workspaceId);
    const isDowngrade = this.isDowngrade(currentPlan, targetPlan);
    if (isDowngrade) {
      await this.validateDowngrade(workspaceId, currentPlan, targetPlan);
    }

    const [updated] = await db
      .update(workspaces)
      .set({ tariffPlanId: targetPlan.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workspaces.id, workspaceId))
      .returning();

    if (!updated) throw new Error("Workspace not found");
    // Начисляем подписочные кредиты при смене плана (активация/реню)
    const amount = Number(targetPlan.includedCreditsAmount ?? 0);
    const sourceRef = `plan-change:${workspaceId}:${targetPlan.id}:${updated.updatedAt?.toISOString?.() ?? Date.now()}`;
    await grantSubscriptionCreditsOnEvent({
      workspaceId,
      planId: targetPlan.id,
      planCode: targetPlan.code,
      amount,
      sourceRef,
      period: "monthly",
    });
    return targetPlan;
  }
}

export const workspacePlanService = new WorkspacePlanService();

import { db } from "./db";
import { workspaces } from "@shared/schema";
import { eq } from "drizzle-orm";
import { tariffPlanService, type TariffPlanWithLimits } from "./tariff-plan-service";

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

  async updateWorkspacePlan(workspaceId: string, planCode: string) {
    const plan = await tariffPlanService.getPlanByCode(planCode);
    if (!plan) throw new Error("Tariff plan not found");

    const [updated] = await db
      .update(workspaces)
      .set({ tariffPlanId: plan.id })
      .where(eq(workspaces.id, workspaceId))
      .returning();

    if (!updated) throw new Error("Workspace not found");
    return plan;
  }
}

export const workspacePlanService = new WorkspacePlanService();

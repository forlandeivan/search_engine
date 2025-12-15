import { db } from "./db";
import { workspaces } from "@shared/schema";
import { eq } from "drizzle-orm";
import { tariffPlanService, type TariffPlanWithLimits } from "./tariff-plan-service";

export class WorkspacePlanService {
  async getWorkspacePlan(workspaceId: string) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) {
      throw new Error("Workspace not found");
    }
    const plan = await tariffPlanService.getPlanById(ws.tariffPlanId);
    if (!plan) {
      throw new Error("Tariff plan not found");
    }
    return plan;
  }

  async getWorkspacePlanWithLimits(workspaceId: string): Promise<TariffPlanWithLimits> {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) {
      throw new Error("Workspace not found");
    }
    const plan = await tariffPlanService.getPlanWithLimitsById(ws.tariffPlanId);
    if (!plan) {
      throw new Error("Tariff plan not found");
    }
    return plan;
  }

  async updateWorkspacePlan(workspaceId: string, planCode: string) {
    const plan = await tariffPlanService.getPlanByCode(planCode);
    if (!plan) {
      throw new Error("Tariff plan not found");
    }
    const [updated] = await db
      .update(workspaces)
      .set({ tariffPlanId: plan.id })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    if (!updated) {
      throw new Error("Workspace not found");
    }
    return plan;
  }
}

export const workspacePlanService = new WorkspacePlanService();

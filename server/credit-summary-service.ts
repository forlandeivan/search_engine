import { ensureWorkspaceCreditAccount } from "./credits-service";
import { workspacePlanService } from "./workspace-plan-service";

export type CreditSummary = {
  workspaceId: string;
  currentBalance: number;
  nextRefreshAt: Date | null;
  planLimit: { amount: number; period: "monthly" };
  policy: { period: "monthly"; rollover: "no_carryover" };
};

export async function getWorkspaceCreditSummary(workspaceId: string): Promise<CreditSummary> {
  const account = await ensureWorkspaceCreditAccount(workspaceId);
  const plan = await workspacePlanService.getWorkspacePlan(workspaceId);

  const period = (plan.includedCreditsPeriod as string) ?? "monthly";
  const amount = Number(plan.includedCreditsAmount ?? 0);

  return {
    workspaceId,
    currentBalance: Number(account.currentBalance ?? 0),
    nextRefreshAt: account.nextTopUpAt ?? null,
    planLimit: { amount, period: "monthly" },
    policy: { period: "monthly", rollover: "no_carryover" },
  };
}

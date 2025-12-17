import { db } from "./db";
import {
  workspaceCreditAccounts,
  workspaceCreditLedger,
  workspaces,
  type WorkspaceCreditAccount,
  type WorkspaceCreditLedgerEntry,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export type CreditEntryType = "subscription_grant";

export type SubscriptionCreditGrantPayload = {
  workspaceId: string;
  planId?: string | null;
  planCode?: string | null;
  subscriptionId?: string | null;
  amount: number;
  sourceRef: string;
  period?: "monthly";
  occurredAt?: Date;
  nextTopUpAt?: Date | null;
};

export async function ensureWorkspaceCreditAccount(workspaceId: string): Promise<WorkspaceCreditAccount> {
  await db
    .insert(workspaceCreditAccounts)
    .values({ workspaceId })
    .onConflictDoNothing()
    .returning();
  const [row] = await db.select().from(workspaceCreditAccounts).where(eq(workspaceCreditAccounts.workspaceId, workspaceId));
  if (!row) {
    throw new Error("Failed to ensure credit account");
  }
  return row;
}

export async function getWorkspaceCreditAccount(workspaceId: string): Promise<WorkspaceCreditAccount | null> {
  const [row] = await db.select().from(workspaceCreditAccounts).where(eq(workspaceCreditAccounts.workspaceId, workspaceId));
  return row ?? null;
}

function addMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function grantSubscriptionCreditsOnEvent(
  payload: SubscriptionCreditGrantPayload,
): Promise<{ account: WorkspaceCreditAccount; ledger?: WorkspaceCreditLedgerEntry }> {
  const amount = Math.max(0, Math.floor(payload.amount ?? 0));
  const period = (payload.period ?? "monthly") as "monthly";
  const sourceRef = payload.sourceRef?.trim();
  if (!sourceRef) {
    throw new Error("sourceRef is required for idempotency");
  }
  if (!payload.workspaceId) {
    throw new Error("workspaceId is required");
  }

  const occurredAt = payload.occurredAt ?? new Date();
  const nextTopUpAt = payload.nextTopUpAt ?? addMonth(occurredAt);

  await ensureWorkspaceCreditAccount(payload.workspaceId);

  let ledgerEntry: WorkspaceCreditLedgerEntry | undefined;

  await db.transaction(async (tx) => {
    // try insert ledger (idempotent by unique index)
    if (amount > 0) {
      try {
        const inserted = await tx
          .insert(workspaceCreditLedger)
          .values({
            workspaceId: payload.workspaceId,
            amountDelta: amount,
            entryType: "subscription_grant",
            sourceRef,
            planId: payload.planId ?? null,
            planCode: payload.planCode ?? null,
            subscriptionId: payload.subscriptionId ?? null,
            period,
            occurredAt,
            metadata: sql`jsonb_build_object('period', ${period})`,
          })
          .returning();
        ledgerEntry = inserted[0];
      } catch (error: any) {
        const message = typeof error?.message === "string" ? error.message : "";
        if (!message.toLowerCase().includes("workspace_credit_ledger_source_uq")) {
          throw error;
        }
        // duplicate -> idempotent no-op
      }
    }

    // update balance and nextTopUpAt (even if amount 0, but only if not duplicate)
    await tx
      .insert(workspaceCreditAccounts)
      .values({
        workspaceId: payload.workspaceId,
        currentBalance: amount,
        nextTopUpAt,
      })
      .onConflictDoUpdate({
        target: workspaceCreditAccounts.workspaceId,
        set: {
          currentBalance: sql`${workspaceCreditAccounts.currentBalance} + ${amount}`,
          nextTopUpAt,
          updatedAt: new Date(),
        },
      });
  });

  const account = await ensureWorkspaceCreditAccount(payload.workspaceId);

  return { account, ledger: ledgerEntry };
}

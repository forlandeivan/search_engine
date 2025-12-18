import { db } from "./db";
import {
  workspaceCreditAccounts,
  workspaceCreditLedger,
  workspaces,
  users,
  type WorkspaceCreditAccount,
  type WorkspaceCreditLedgerEntry,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { centsToCredits } from "@shared/credits";

export type CreditEntryType = "subscription_grant" | "manual_adjustment";
export type CreditType = "subscription" | "bonus" | "purchased";

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

type ManualAdjustmentPayload = {
  workspaceId: string;
  amountDelta: number;
  reason: string;
  actorUserId: string | null;
  sourceRef?: string | null;
  occurredAt?: Date;
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
  const amount = Math.max(0, Math.trunc(payload.amount ?? 0));
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

  let ledgerEntry: WorkspaceCreditLedgerEntry | undefined;
  let accountAfter: WorkspaceCreditAccount | null = null;

  await db.transaction(async (tx) => {
    // ensure account row and lock
    await tx
      .insert(workspaceCreditAccounts)
      .values({ workspaceId: payload.workspaceId })
      .onConflictDoNothing();
    const [accountRow] = await tx
      .select()
      .from(workspaceCreditAccounts)
      .where(eq(workspaceCreditAccounts.workspaceId, payload.workspaceId))
      .for("update");
    const currentBalance = Number(accountRow?.currentBalance ?? 0);

    // reset подписочного остатка (не переносим)
    if (currentBalance > 0) {
      const resetSourceRef = `${sourceRef}:reset`;
      try {
        await tx
          .insert(workspaceCreditLedger)
          .values({
            workspaceId: payload.workspaceId,
            amountDelta: -currentBalance,
            entryType: "subscription_grant",
            creditType: "subscription",
            sourceRef: resetSourceRef,
            planId: payload.planId ?? null,
            planCode: payload.planCode ?? null,
            subscriptionId: payload.subscriptionId ?? null,
            period,
            occurredAt,
            metadata: { reset: true, period },
          })
          .onConflictDoNothing();
      } catch (error: any) {
        const message = typeof error?.message === "string" ? error.message : "";
        if (!message.toLowerCase().includes("workspace_credit_ledger_source_uq")) {
          throw error;
        }
      }

      await tx
        .update(workspaceCreditAccounts)
        .set({
          currentBalance: 0,
          nextTopUpAt,
          updatedAt: new Date(),
        })
        .where(eq(workspaceCreditAccounts.workspaceId, payload.workspaceId));
    }

    // try insert ledger (idempotent by unique index)
    if (amount > 0) {
      try {
        const inserted = await tx
          .insert(workspaceCreditLedger)
          .values({
            workspaceId: payload.workspaceId,
            amountDelta: amount,
            entryType: "subscription_grant",
            creditType: "subscription",
            sourceRef,
            planId: payload.planId ?? null,
            planCode: payload.planCode ?? null,
            subscriptionId: payload.subscriptionId ?? null,
            period,
            expiresAt: nextTopUpAt,
            occurredAt,
            metadata: { period },
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

    // update balance and nextTopUpAt (даже при amount 0)
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

    const [after] = await tx
      .select()
      .from(workspaceCreditAccounts)
      .where(eq(workspaceCreditAccounts.workspaceId, payload.workspaceId));
    accountAfter = after ?? null;
  });

  const account = accountAfter ?? (await ensureWorkspaceCreditAccount(payload.workspaceId));

  return { account, ledger: ledgerEntry };
}

export type ManualAdjustmentView = {
  id: string;
  amountDelta: number;
  reason: string | null;
  actorUserId: string | null;
  actorFullName: string | null;
  occurredAt: Date;
};

export async function getRecentManualAdjustments(
  workspaceId: string,
  limit = 10,
): Promise<ManualAdjustmentView[]> {
  const rows = await db
    .select({
      id: workspaceCreditLedger.id,
      amountDelta: workspaceCreditLedger.amountDelta,
      reason: workspaceCreditLedger.reason,
      actorUserId: workspaceCreditLedger.actorUserId,
      actorFullName: users.fullName,
      occurredAt: workspaceCreditLedger.occurredAt,
    })
    .from(workspaceCreditLedger)
    .leftJoin(users, eq(users.id, workspaceCreditLedger.actorUserId))
    .where(
      and(eq(workspaceCreditLedger.workspaceId, workspaceId), eq(workspaceCreditLedger.entryType, "manual_adjustment")),
    )
    .orderBy(sql`${workspaceCreditLedger.occurredAt} desc`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    amountDelta: centsToCredits(row.amountDelta ?? 0),
    reason: row.reason ?? null,
    actorUserId: row.actorUserId ?? null,
    actorFullName: row.actorFullName ?? null,
    occurredAt: row.occurredAt ?? new Date(0),
  }));
}

export async function applyManualCreditAdjustment(payload: ManualAdjustmentPayload): Promise<WorkspaceCreditAccount> {
  const workspaceId = payload.workspaceId;
  if (!workspaceId) {
    throw new Error("workspaceId is required");
  }
  const reason = (payload.reason ?? "").trim();
  if (!reason) {
    throw new Error("reason is required");
  }
  const amountDelta = Math.trunc(Number(payload.amountDelta ?? 0));
  if (amountDelta === 0) {
    throw new Error("amountDelta must be non-zero");
  }
  const sourceRef = (payload.sourceRef ?? randomUUID()).trim();
  const occurredAt = payload.occurredAt ?? new Date();

  let accountAfter: WorkspaceCreditAccount | null = null;

  await db.transaction(async (tx) => {
    await tx
      .insert(workspaceCreditAccounts)
      .values({ workspaceId })
      .onConflictDoNothing();
    const [account] = await tx
      .select()
      .from(workspaceCreditAccounts)
      .where(eq(workspaceCreditAccounts.workspaceId, workspaceId))
      .for("update");
    const current = Number(account?.currentBalance ?? 0);
    const next = current + amountDelta;
    if (next < 0) {
      throw new Error("balance_cannot_be_negative");
    }

    await tx.insert(workspaceCreditLedger).values({
      workspaceId,
      amountDelta,
      entryType: "manual_adjustment",
      creditType: amountDelta > 0 ? "bonus" : "subscription",
      sourceRef,
      reason,
      actorUserId: payload.actorUserId ?? null,
      occurredAt,
      metadata: sql`jsonb_build_object('reason', ${reason})`,
    });

    await tx
      .update(workspaceCreditAccounts)
      .set({
        currentBalance: next,
        updatedAt: new Date(),
      })
      .where(eq(workspaceCreditAccounts.workspaceId, workspaceId));

    const [after] = await tx
      .select()
      .from(workspaceCreditAccounts)
      .where(eq(workspaceCreditAccounts.workspaceId, workspaceId));
    accountAfter = after ?? null;
  });

  if (!accountAfter) {
    throw new Error("Failed to update balance");
  }
  return accountAfter;
}

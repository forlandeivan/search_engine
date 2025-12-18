import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  workspaceCreditAccounts,
  workspaceCreditLedger,
  type ModelConsumptionUnit,
  type ModelType,
} from "@shared/schema";
import type { UsageMeasurement } from "./consumption-meter";
import type { PriceCalculationResult } from "./price-calculator";
import { InsufficientCreditsError } from "./credits-precheck";

const USAGE_ENTRY_TYPE = "usage_charge";

export class IdempotencyKeyReusedError extends Error {
  code = "IDEMPOTENCY_KEY_REUSED";
  status: number;
  details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>, status = 409) {
    super(message);
    this.name = "IdempotencyKeyReusedError";
    this.status = status;
    this.details = details;
  }
}

export type IdempotentChargeInput = {
  workspaceId: string;
  operationId: string;
  model?: {
    id?: string | null;
    key?: string | null;
    name?: string | null;
    consumptionUnit?: ModelConsumptionUnit | null;
    type?: ModelType | null;
  };
  measurement: UsageMeasurement;
  price: PriceCalculationResult;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
};

export type IdempotentChargeResult = {
  charged: boolean;
  ledgerEntryId: string;
  balanceAfter?: number;
};

function normalizeOperationId(operationId: string): string {
  return (operationId || "").trim();
}

function buildMetadata(input: IdempotentChargeInput): Record<string, unknown> {
  return {
    operationId: input.operationId,
    modelId: input.model?.id ?? null,
    modelKey: input.model?.key ?? null,
    modelName: input.model?.name ?? null,
    modelType: input.model?.type ?? null,
    consumptionUnit: input.model?.consumptionUnit ?? input.measurement.unit ?? null,
    quantityRaw: input.measurement.quantityRaw,
    quantityUnits: input.measurement.quantityUnits,
    appliedCreditsPerUnit: input.price.appliedCreditsPerUnit,
    creditsCharged: input.price.creditsCharged,
    ...input.metadata,
  };
}

function isSameCharge(existing: { amountDelta: number; metadata: unknown }, input: IdempotentChargeInput): boolean {
  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const normalizedAmount = Math.max(0, Math.floor(input.price.creditsCharged ?? 0));
  if (existing.amountDelta !== -normalizedAmount) return false;

  const sameModel =
    (metadata.modelId ?? null) === (input.model?.id ?? null) &&
    (metadata.modelKey ?? null) === (input.model?.key ?? null) &&
    (metadata.modelType ?? null) === (input.model?.type ?? null) &&
    (metadata.consumptionUnit ?? null) === (input.model?.consumptionUnit ?? input.measurement.unit ?? null);

  const sameMeasurement =
    metadata.quantityRaw === input.measurement.quantityRaw &&
    metadata.quantityUnits === input.measurement.quantityUnits;

  const samePricing = metadata.appliedCreditsPerUnit === input.price.appliedCreditsPerUnit;

  return sameModel && sameMeasurement && samePricing;
}

export async function applyIdempotentUsageCharge(input: IdempotentChargeInput): Promise<IdempotentChargeResult> {
  const operationId = normalizeOperationId(input.operationId);
  if (!operationId) {
    throw new Error("operationId is required for idempotent charge");
  }

  const creditsToCharge = Math.max(0, Math.floor(input.price.creditsCharged ?? 0));

  const occurredAt = input.occurredAt ?? new Date();
  const metadata = buildMetadata(input);

  return db.transaction(async (tx) => {
    await tx
      .insert(workspaceCreditAccounts)
      .values({ workspaceId: input.workspaceId })
      .onConflictDoNothing();

    const [account] = await tx
      .select()
      .from(workspaceCreditAccounts)
      .where(eq(workspaceCreditAccounts.workspaceId, input.workspaceId))
      .for("update");

    const available = Math.max(0, Number(account?.currentBalance ?? 0));
    if (available < creditsToCharge) {
      throw new InsufficientCreditsError("Недостаточно кредитов", {
        availableCredits: available,
        requiredCredits: creditsToCharge,
        operationId,
        modelId: input.model?.id ?? null,
        modelKey: input.model?.key ?? null,
        modelName: input.model?.name ?? null,
        unit: input.measurement.unit,
        quantityRaw: input.measurement.quantityRaw,
        quantityUnits: input.measurement.quantityUnits,
      });
    }

    const inserted = await tx
      .insert(workspaceCreditLedger)
      .values({
        workspaceId: input.workspaceId,
        amountDelta: -creditsToCharge,
        entryType: USAGE_ENTRY_TYPE,
        creditType: "subscription",
        sourceRef: operationId,
        reason: "usage_charge",
        occurredAt,
        metadata,
      })
      .onConflictDoNothing()
      .returning({ id: workspaceCreditLedger.id, amountDelta: workspaceCreditLedger.amountDelta, metadata: workspaceCreditLedger.metadata });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({
          id: workspaceCreditLedger.id,
          amountDelta: workspaceCreditLedger.amountDelta,
          metadata: workspaceCreditLedger.metadata,
        })
        .from(workspaceCreditLedger)
        .where(
          and(
            eq(workspaceCreditLedger.workspaceId, input.workspaceId),
            eq(workspaceCreditLedger.entryType, USAGE_ENTRY_TYPE),
            eq(workspaceCreditLedger.sourceRef, operationId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error("Failed to fetch existing usage charge after conflict");
      }

      if (!isSameCharge(existing, input)) {
        throw new IdempotencyKeyReusedError("Operation already charged with different parameters", {
          operationId,
          existing,
          requested: {
            amountDelta: -creditsToCharge,
            metadata,
          },
        });
      }

      return { charged: false, ledgerEntryId: existing.id, balanceAfter: available };
    }

    const [updatedAccount] = await tx
      .update(workspaceCreditAccounts)
      .set({
        currentBalance: Math.max(0, available - creditsToCharge),
        updatedAt: new Date(),
      })
      .where(eq(workspaceCreditAccounts.workspaceId, input.workspaceId))
      .returning({ currentBalance: workspaceCreditAccounts.currentBalance });

    return {
      charged: true,
      ledgerEntryId: inserted[0].id,
      balanceAfter: Math.max(0, Number(updatedAccount?.currentBalance ?? 0)),
    };
  });
}

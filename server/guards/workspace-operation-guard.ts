import { OPERATION_TYPES, type GuardDecision, type OperationContext } from "./types";
import { getWorkspaceUsageSnapshot } from "../usage/usage-service";
import { logGuardBlockEvent } from "./block-log-service";

const ALLOWED_DECISION: GuardDecision = {
  allowed: true,
  reasonCode: "ALLOWED",
  resourceType: null,
  message: "Operation allowed",
  upgradeAvailable: false,
  debug: null,
};

export class WorkspaceOperationGuard {
  async check(context: OperationContext): Promise<GuardDecision> {
    // simple allow-all guard; extend with real rules later
    const { workspaceId, operationType, expectedCost } = context;
    const isKnownOperation = OPERATION_TYPES.includes(operationType);
    const decision = { ...ALLOWED_DECISION };

    let snapshot: unknown = null;
    try {
      snapshot = await getWorkspaceUsageSnapshot(workspaceId);
    } catch (error) {
      console.warn(
        `[guard] failed to fetch usage snapshot for workspace ${workspaceId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    const logPayload = {
      workspaceId,
      operationType,
      expectedCost: expectedCost ?? null,
      allowed: decision.allowed,
      reasonCode: decision.reasonCode,
      knownOperationType: isKnownOperation,
      usageSnapshot: snapshot,
    };

    // use console.debug to avoid noise in production logs
    console.debug("[guard] workspace operation decision", logPayload);

    decision.debug = {
      operationType,
      expectedCost: expectedCost ?? null,
      usageSnapshot: snapshot,
    };

    if (!decision.allowed) {
      await logGuardBlockEvent(decision, context, snapshot as any);
    }

    return decision;
  }
}

export const workspaceOperationGuard = new WorkspaceOperationGuard();

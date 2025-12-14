import { OPERATION_TYPES, type GuardDecision, type OperationContext } from "./types";

const ALLOWED_DECISION: GuardDecision = {
  allowed: true,
  reasonCode: "ALLOWED",
  resourceType: null,
  message: "Operation allowed",
  upgradeAvailable: false,
  debug: null,
};

export class WorkspaceOperationGuard {
  check(context: OperationContext): GuardDecision {
    // simple allow-all guard; extend with real rules later
    const { workspaceId, operationType, expectedCost } = context;
    const isKnownOperation = OPERATION_TYPES.includes(operationType);
    const decision = { ...ALLOWED_DECISION };

    const logPayload = {
      workspaceId,
      operationType,
      expectedCost: expectedCost ?? null,
      allowed: decision.allowed,
      reasonCode: decision.reasonCode,
      knownOperationType: isKnownOperation,
    };

    // use console.debug to avoid noise in production logs
    console.debug("[guard] workspace operation decision", logPayload);

    return decision;
  }
}

export const workspaceOperationGuard = new WorkspaceOperationGuard();

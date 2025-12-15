import type { GuardDecision, OperationBlockedPayload, OperationContext, BlockReasonCode, ResourceType } from "./types";

function normalizeReason(reason: string | BlockReasonCode): BlockReasonCode {
  const known: BlockReasonCode[] = [
    "ALLOWED",
    "USAGE_LIMIT_REACHED",
    "OPERATION_NOT_ALLOWED",
    "PLAN_RESTRICTED",
    "WORKSPACE_SUSPENDED",
    "UNKNOWN",
  ];
  return (known as string[]).includes(reason) ? (reason as BlockReasonCode) : "UNKNOWN";
}

function normalizeResource(resource: string | null | undefined): ResourceType {
  const known: ResourceType[] = ["tokens", "embeddings", "asr", "storage", "objects", "other"];
  if (resource && (known as string[]).includes(resource)) {
    return resource as ResourceType;
  }
  return "other";
}

export function mapDecisionToPayload(
  decision: GuardDecision,
  context?: Partial<OperationContext>,
): OperationBlockedPayload {
  return {
    reasonCode: normalizeReason(decision.reasonCode),
    resourceType: decision.resourceType ? normalizeResource(decision.resourceType) : "other",
    message: decision.message,
    upgradeAvailable: decision.upgradeAvailable ?? false,
    limitsHint:
      decision.limitsHint && (decision.limitsHint.current !== undefined || decision.limitsHint.limit !== undefined)
        ? {
            current: decision.limitsHint.current,
            limit: decision.limitsHint.limit === null ? null : decision.limitsHint.limit ?? undefined,
            unit: decision.limitsHint.unit,
          }
        : undefined,
    operationType: context?.operationType,
    workspaceId: context?.workspaceId,
    meta: context?.meta as Record<string, unknown> | undefined,
    correlationId: context && "correlationId" in context ? (context as any).correlationId : undefined,
  };
}

export class OperationBlockedError extends Error {
  public payload: OperationBlockedPayload;
  public status: number;

  constructor(payload: OperationBlockedPayload, status = 429) {
    super(payload.message || "Operation blocked");
    this.name = "OperationBlockedError";
    this.payload = payload;
    this.status = status;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.name,
      ...this.payload,
    };
  }
}

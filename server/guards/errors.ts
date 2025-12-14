import type { GuardDecision } from "./types";

export class OperationBlockedError extends Error {
  public decision: GuardDecision;
  public status: number;

  constructor(decision: GuardDecision, status = 429) {
    super(decision.message || "Operation blocked");
    this.name = "OperationBlockedError";
    this.decision = decision;
    this.status = status;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.name,
      message: this.message,
      allowed: this.decision.allowed,
      reasonCode: this.decision.reasonCode,
      resourceType: this.decision.resourceType,
      upgradeAvailable: this.decision.upgradeAvailable,
      debug: this.decision.debug ?? null,
    };
  }
}

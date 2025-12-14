import { mapDecisionToPayload, OperationBlockedError } from "../server/guards/errors";
import type { GuardDecision } from "../server/guards/types";

describe("guard decision mapper", () => {
  it("maps decision to payload and OperationBlockedError", () => {
    const decision: GuardDecision = {
      allowed: false,
      reasonCode: "USAGE_LIMIT_REACHED",
      resourceType: "tokens",
      message: "Limit reached",
      upgradeAvailable: true,
      debug: null,
    };

    const payload = mapDecisionToPayload(decision, {
      workspaceId: "ws-1",
      operationType: "LLM_REQUEST",
    });

    expect(payload.reasonCode).toBe("USAGE_LIMIT_REACHED");
    expect(payload.resourceType).toBe("tokens");
    expect(payload.operationType).toBe("LLM_REQUEST");

    const error = new OperationBlockedError(payload);
    const json = error.toJSON();
    expect(json.reasonCode).toBe("USAGE_LIMIT_REACHED");
    expect(json.resourceType).toBe("tokens");
    expect(json.message).toBe("Limit reached");
    expect(json.upgradeAvailable).toBe(true);
  });
});

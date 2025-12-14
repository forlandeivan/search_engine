import { describe, expect, it } from "vitest";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";
import type { OperationContext } from "../server/guards/types";

describe("workspace operation guard (allow-all)", () => {
  it("returns allow decision with reasonCode ALLOWED", () => {
    const context: OperationContext = {
      workspaceId: "ws-1",
      operationType: "LLM_REQUEST",
      expectedCost: { kind: "tokens", value: 100 },
      meta: { model: "gpt-test" },
    };

    const decision = workspaceOperationGuard.check(context);

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
    expect(decision.message).toBe("Operation allowed");
    expect(decision.resourceType).toBeNull();
    expect(decision.upgradeAvailable).toBe(false);
  });
});

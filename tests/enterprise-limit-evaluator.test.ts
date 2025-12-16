import { describe, expect, it } from "vitest";
import { limitEvaluator } from "../server/guards/limit-evaluator";
import type { UsageSnapshot } from "../server/guards/usage-snapshot-provider";
import type { LimitRule } from "../server/guards/types";

const baseSnapshot: UsageSnapshot = {
  llmTokensTotal: 0,
  embeddingsTokensTotal: 0,
  asrMinutesTotal: 0,
  storageBytesTotal: 0,
  skillsCount: 0,
  knowledgeBasesCount: 0,
  actionsCount: 0,
  membersCount: 0,
  qdrantStorageBytes: 0,
};

describe("Enterprise behavior is data-driven (no plan code checks)", () => {
  it("unlimited limit_value null never blocks", () => {
    const rules: LimitRule[] = [
      {
        limitKey: "STORAGE_BYTES",
        resourceType: "storage",
        unit: "bytes",
        limitValue: null, // unlimited
        scope: "workspace",
      },
    ];

    const decision = limitEvaluator.evaluate({
      context: { workspaceId: "ws", operationType: "STORAGE_UPLOAD", expectedCost: { bytes: 10 } },
      snapshot: baseSnapshot,
      rules,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
  });

  it("small limit blocks regardless of plan name (data only)", () => {
    const rules: LimitRule[] = [
      {
        limitKey: "STORAGE_BYTES",
        resourceType: "storage",
        unit: "bytes",
        limitValue: 1,
        scope: "workspace",
      },
    ];

    const decision = limitEvaluator.evaluate({
      context: { workspaceId: "ws", operationType: "STORAGE_UPLOAD", expectedCost: { bytes: 5 } },
      snapshot: { ...baseSnapshot, storageBytesTotal: 0 },
      rules,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("USAGE_LIMIT_REACHED");
    expect(decision.limitsHint?.limitKey).toBe("STORAGE_BYTES");
  });
});

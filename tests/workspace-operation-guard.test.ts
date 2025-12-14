import { describe, expect, it } from "vitest";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";
import * as usageService from "../server/usage/usage-service";
import type { OperationContext } from "../server/guards/types";

describe("workspace operation guard (allow-all)", () => {
  it("returns allow decision with reasonCode ALLOWED", () => {
    vi.spyOn(usageService, "getWorkspaceUsageSnapshot").mockResolvedValue({
      workspaceId: "ws-1",
      periodCode: "2025-12",
      llmTokensTotal: 0,
      embeddingsTokensTotal: 0,
      asrMinutesTotal: 0,
      storageBytesTotal: 0,
      skillsCount: 0,
      actionsCount: 0,
      knowledgeBasesCount: 0,
      membersCount: 0,
      qdrantCollectionsCount: 0,
      qdrantPointsCount: 0,
      qdrantStorageBytes: 0,
    });

    const context: OperationContext = {
      workspaceId: "ws-1",
      operationType: "LLM_REQUEST",
      expectedCost: { tokens: 100 },
      meta: { llm: { model: "gpt-test", scenario: "chat" } },
    };

    const decision = await workspaceOperationGuard.check(context);

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
    expect(decision.message).toBe("Operation allowed");
    expect(decision.resourceType).toBeNull();
    expect(decision.upgradeAvailable).toBe(false);
  });
});

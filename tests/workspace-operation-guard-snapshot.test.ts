import { describe, expect, it, vi } from "vitest";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";
import * as usageService from "../server/usage/usage-service";
import type { OperationContext } from "../server/guards/types";

describe("workspace operation guard pulls usage snapshot", () => {
  it("includes snapshot in debug", async () => {
    const snapshot = {
      workspaceId: "ws-1",
      periodCode: "2025-12",
      llmTokensTotal: 1,
      embeddingsTokensTotal: 2,
      asrMinutesTotal: 3,
      storageBytesTotal: 4,
      skillsCount: 5,
      actionsCount: 6,
      knowledgeBasesCount: 7,
      membersCount: 8,
      qdrantCollectionsCount: 9,
      qdrantPointsCount: 10,
      qdrantStorageBytes: 11,
    };

    const spy = vi.spyOn(usageService, "getWorkspaceUsageSnapshot").mockResolvedValue(snapshot);

    const context: OperationContext = {
      workspaceId: "ws-1",
      operationType: "LLM_REQUEST",
    };

    const decision = await workspaceOperationGuard.check(context);

    expect(decision.allowed).toBe(true);
    expect(decision.debug?.usageSnapshot).toEqual(snapshot);

    spy.mockRestore();
  });
});

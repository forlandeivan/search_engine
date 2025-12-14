import { describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import app from "../server";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";
import { OperationBlockedError } from "../server/guards/errors";

describe("workspace operation guard integration", () => {
  it("blocks upsert points when guard denies", async () => {
    const checkSpy = vi.spyOn(workspaceOperationGuard, "check").mockResolvedValue({
      allowed: false,
      reasonCode: "TEST_DENY",
      resourceType: "objects",
      message: "Blocked by test",
      upgradeAvailable: false,
      debug: { test: true },
    });

    const response = await supertest(app)
      .post("/api/vector/collections/test-collection/points")
      .set("x-workspace-id", "ws-test")
      .send({ points: [] });

    expect(response.status).toBe(429);
    expect(response.body?.reasonCode).toBe("TEST_DENY");

    checkSpy.mockRestore();
  });
});

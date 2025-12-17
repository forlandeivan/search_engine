import { describe, expect, it } from "vitest";
import { assertSufficientWorkspaceCredits, InsufficientCreditsError } from "../server/credits-precheck";
import { db } from "../server/db";
import { workspaceCreditAccounts, workspaces, users } from "@shared/schema";

describe("credits precheck", () => {
  it("passes when required is zero", async () => {
    await assertSufficientWorkspaceCredits("ws-zero", 0);
  });

  it("throws INSUFFICIENT_CREDITS when balance is lower", async () => {
    const workspaceId = `ws-precheck-${Date.now()}`;
    const userId = `user-${Date.now()}`;
    await db.insert(users).values({
      id: userId,
      email: `${workspaceId}@example.com`,
      fullName: "Precheck User",
      firstName: "Precheck",
      lastName: "User",
      phone: "",
      passwordHash: "",
    });
    await db.insert(workspaces).values({ id: workspaceId, name: workspaceId, ownerId: userId }).onConflictDoNothing();
    await db.insert(workspaceCreditAccounts).values({ workspaceId, currentBalance: 5 }).onConflictDoNothing();
    await expect(assertSufficientWorkspaceCredits(workspaceId, 10, { modelKey: "test" })).rejects.toThrow(
      InsufficientCreditsError,
    );
  });

  it("passes when balance is sufficient", async () => {
    const workspaceId = `ws-precheck-ok-${Date.now()}`;
    const userId = `user-${workspaceId}`;
    await db.insert(users).values({
      id: userId,
      email: `${workspaceId}@example.com`,
      fullName: "Precheck User",
      firstName: "Precheck",
      lastName: "User",
      phone: "",
      passwordHash: "",
    });
    await db.insert(workspaces).values({ id: workspaceId, name: workspaceId, ownerId: userId }).onConflictDoNothing();
    await db.insert(workspaceCreditAccounts).values({ workspaceId, currentBalance: 20 }).onConflictDoNothing();
    await assertSufficientWorkspaceCredits(workspaceId, 10);
  });
});

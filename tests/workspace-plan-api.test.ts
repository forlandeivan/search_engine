import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { db } from "../server/db";
import { tariffPlans, users, workspaces } from "@shared/schema";
import { eq } from "drizzle-orm";

let workspaceId = "";
let planCode = "";
let userId = "";

vi.doMock("../server/auth", () => {
  const allow = (_req: any, _res: any, next: () => void) => next();
  return {
    requireAuth: allow,
    requireAdmin: allow,
    ensureWorkspaceContextMiddleware: () => allow,
    getSessionUser: () => ({ id: userId, role: "user" }),
    toPublicUser: (user: unknown) => user,
    reloadGoogleAuth: vi.fn(),
    reloadYandexAuth: vi.fn(),
    ensureWorkspaceContext: vi.fn(),
    buildSessionResponse: vi.fn(),
    getRequestWorkspace: () => ({ id: workspaceId }),
    getRequestWorkspaceMemberships: () => [{ id: workspaceId }],
    resolveOptionalUser: () => ({ id: userId }),
    WorkspaceContextError: class extends Error {},
  };
});

async function createTestServer() {
  const appModule = await import("express");
  const app = appModule.default();
  app.use(appModule.json());
  const { registerRoutes } = await import("../server/routes");
  const httpServer = await registerRoutes(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  return { httpServer };
}

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Workspace Plan User",
    firstName: "Workspace",
    lastName: "Plan",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });

  return {
    ...user,
    hasPersonalApiToken: false,
    personalApiTokenLastFour: null,
  };
}

describe("workspace plan API", () => {
  beforeAll(async () => {
    const runId = Date.now();
    planCode = `TEST_WS_PLAN_${runId}`;
    const user = await createUser(`workspace-plan-${runId}@example.com`);
    userId = user.id;

    const [plan] = await db
      .insert(tariffPlans)
      .values({ code: planCode, name: "Workspace plan", isActive: true, noCodeFlowEnabled: true })
      .returning({ id: tariffPlans.id });

    workspaceId = `workspace-plan-${runId}`;
    await db
      .insert(workspaces)
      .values({
        id: workspaceId,
        name: "Workspace Plan",
        ownerId: userId,
        tariffPlanId: plan.id,
      })
      .returning({ id: workspaces.id });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(tariffPlans).where(eq(tariffPlans.code, planCode));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("returns noCodeFlowEnabled in workspace plan response", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/workspaces/${workspaceId}/plan`);
    expect(res.status).toBe(200);
    expect(res.body?.plan?.noCodeFlowEnabled).toBe(true);
    httpServer.close();
  });
});

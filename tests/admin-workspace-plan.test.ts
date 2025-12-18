import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { tariffPlans, users, workspaces } from "@shared/schema";

vi.doMock("../server/auth", () => {
  const allow = (_req: any, _res: any, next: () => void) => next();
  const deny = (_req: any, res: any) => res.status(403).json({ message: "forbidden" });
  return {
    requireAuth: allow,
    requireAdmin: allow,
    getSessionUser: () => ({ id: "admin-1", role: "admin" }),
    toPublicUser: (user: unknown) => user,
    reloadGoogleAuth: vi.fn(),
    reloadYandexAuth: vi.fn(),
    ensureWorkspaceContext: vi.fn(),
    buildSessionResponse: vi.fn(),
    getRequestWorkspace: () => ({ id: "workspace-1" }),
    getRequestWorkspaceMemberships: () => [],
    resolveOptionalUser: () => ({ id: "admin-1" }),
    WorkspaceContextError: class extends Error {},
    _denyAdmin: deny,
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

describe("admin workspace plan API", () => {
  let planFreeId: string;
  let planProId: string;
  let planFreeCode: string;
  let planProCode: string;
  let workspaceId: string;
  let ownerEmail: string;

  const TEST_PLAN_PREFIX = "TEST_WSPLAN_";
  const TEST_USER_EMAIL_PREFIX = "admin-ws-plan-";

  const cleanup = async () => {
    await db.execute(sql`DELETE FROM ${users} WHERE ${users.email} LIKE ${`${TEST_USER_EMAIL_PREFIX}%`}`);
    await db.execute(sql`DELETE FROM ${tariffPlans} WHERE ${tariffPlans.code} LIKE ${`${TEST_PLAN_PREFIX}%`}`);
  };

  beforeAll(async () => {
    await cleanup();

    const runId = Date.now();
    ownerEmail = `${TEST_USER_EMAIL_PREFIX}${runId}@example.com`;
    planFreeCode = `${TEST_PLAN_PREFIX}FREE_${runId}`;
    planProCode = `${TEST_PLAN_PREFIX}PRO_${runId}`;

    const [owner] = await db
      .insert(users)
      .values({
        email: ownerEmail,
        passwordHash: "hash",
        isEmailConfirmed: true,
        firstName: "Admin",
        lastName: "Plan",
        fullName: "Admin Plan",
      })
      .returning({ id: users.id });

    const [free] = await db
      .insert(tariffPlans)
      .values({ code: planFreeCode, name: "Free", isActive: true })
      .returning({ id: tariffPlans.id, code: tariffPlans.code });
    planFreeId = free.id;
    planFreeCode = free.code;

    const [pro] = await db
      .insert(tariffPlans)
      .values({ code: planProCode, name: "Pro", isActive: true })
      .returning({ id: tariffPlans.id, code: tariffPlans.code });
    planProId = pro.id;
    planProCode = pro.code;

    const [ws] = await db
      .insert(workspaces)
      .values({ id: `ws-plan-${runId}`, name: "Test WS", ownerId: owner.id, tariffPlanId: planFreeId })
      .returning({ id: workspaces.id });
    workspaceId = ws.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("returns workspace plan", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/workspaces/${workspaceId}/plan`);
    expect(res.status).toBe(200);
    expect(res.body?.plan?.code).toBe(planFreeCode);
    httpServer.close();
  });

  it("updates workspace plan", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .put(`/api/admin/workspaces/${workspaceId}/plan`)
      .send({ planCode: planProCode });
    expect(res.status).toBe(200);
    expect(res.body?.plan?.code).toBe(planProCode);

    const getRes = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/workspaces/${workspaceId}/plan`);
    expect(getRes.body?.plan?.code).toBe(planProCode);
    httpServer.close();
  });

  it("rejects invalid planCode", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .put(`/api/admin/workspaces/${workspaceId}/plan`)
      .send({ planCode: "UNKNOWN" });
    expect(res.status).toBe(400);
    httpServer.close();
  });
});

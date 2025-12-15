import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import { db } from "../server/db";
import { tariffLimits, tariffPlans, workspaces } from "@shared/schema";

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
  let workspaceId: string;

  beforeAll(async () => {
    await db.delete(tariffLimits);
    await db.delete(tariffPlans);
    await db.delete(workspaces);

    const [free] = await db
      .insert(tariffPlans)
      .values({ code: "FREE", name: "Free" })
      .returning({ id: tariffPlans.id });
    planFreeId = free.id;

    const [pro] = await db
      .insert(tariffPlans)
      .values({ code: "PRO", name: "Pro" })
      .returning({ id: tariffPlans.id });
    planProId = pro.id;

    const [ws] = await db
      .insert(workspaces)
      .values({ id: "ws-test", name: "Test WS", ownerId: "owner-1", tariffPlanId: planFreeId })
      .returning({ id: workspaces.id });
    workspaceId = ws.id;
  });

  it("returns workspace plan", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/workspaces/${workspaceId}/plan`);
    expect(res.status).toBe(200);
    expect(res.body?.plan?.code).toBe("FREE");
    httpServer.close();
  });

  it("updates workspace plan", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .put(`/api/admin/workspaces/${workspaceId}/plan`)
      .send({ planCode: "PRO" });
    expect(res.status).toBe(200);
    expect(res.body?.plan?.code).toBe("PRO");

    const getRes = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/workspaces/${workspaceId}/plan`);
    expect(getRes.body?.plan?.code).toBe("PRO");
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

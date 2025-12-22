import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import { db } from "../server/db";
import { tariffLimits, tariffPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.doMock("../server/auth", () => {
  const allow = (_req: any, _res: any, next: () => void) => next();
  const deny = (_req: any, res: any) => res.status(403).json({ message: "forbidden" });
  return {
    requireAuth: allow,
    requireAdmin: allow,
    ensureWorkspaceContextMiddleware: () => allow,
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

describe("admin tariffs API", () => {
  let planId: string;
  let planCode: string;

  beforeAll(async () => {
    const runId = Date.now();
    planCode = `TEST_PLAN_${runId}`;
    await db.delete(tariffPlans).where(eq(tariffPlans.code, planCode));

    const [plan] = await db
      .insert(tariffPlans)
      .values({ code: planCode, name: "Test plan", isActive: true })
      .returning();
    planId = plan.id;

    await db.insert(tariffLimits).values({
      planId,
      limitKey: "OBJECT_SKILLS",
      unit: "count",
      limitValue: 100,
      isEnabled: true,
    });
  });

  it("lists tariffs", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/tariffs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.tariffs)).toBe(true);
    const plan = res.body.tariffs.find((p: any) => p.code === planCode);
    expect(plan).toBeTruthy();
    expect(plan.noCodeFlowEnabled).toBe(false);
    httpServer.close();
  });

  it("gets tariff detail with limits", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/tariffs/${planId}`);
    expect(res.status).toBe(200);
    expect(res.body?.plan?.id).toBe(planId);
    expect(res.body?.limits?.some((l: any) => l.limitKey === "OBJECT_SKILLS")).toBe(true);
    expect(res.body?.plan?.noCodeFlowEnabled).toBe(false);
    httpServer.close();
  });

  it("updates no-code flag via PUT", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .put(`/api/admin/tariffs/${planId}`)
      .send({ noCodeFlowEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body?.plan?.noCodeFlowEnabled).toBe(true);

    const getRes = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/tariffs/${planId}`);
    expect(getRes.body?.plan?.noCodeFlowEnabled).toBe(true);
    httpServer.close();
  });

  it("updates limits via PUT", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const updateBody = {
      limits: [
        { limitKey: "OBJECT_SKILLS", unit: "count", limitValue: 200, isEnabled: true },
        { limitKey: "STORAGE_BYTES", unit: "bytes", limitValue: null, isEnabled: true },
      ],
    };
    const putRes = await supertest(`http://127.0.0.1:${address.port}`)
      .put(`/api/admin/tariffs/${planId}/limits`)
      .send(updateBody);
    expect(putRes.status).toBe(200);
    expect(putRes.body?.limits?.find((l: any) => l.limitKey === "OBJECT_SKILLS")?.limitValue).toBe(200);
    expect(putRes.body?.limits?.find((l: any) => l.limitKey === "STORAGE_BYTES")?.limitValue).toBeNull();

    const getRes = await supertest(`http://127.0.0.1:${address.port}`).get(`/api/admin/tariffs/${planId}`);
    expect(getRes.body?.limits?.find((l: any) => l.limitKey === "STORAGE_BYTES")?.limitValue).toBeNull();

    httpServer.close();
  });
});

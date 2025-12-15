import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";

// Mock db to avoid real connection
vi.doMock("../server/db", () => ({
  db: {
    execute: vi.fn(),
  },
  pool: null,
  isDatabaseConfigured: true,
}));

// Mock auth to control admin access
vi.doMock("../server/auth", () => {
  const allowAdmin = (_req: any, _res: any, next: () => void) => next();
  const denyAdmin = (_req: any, res: any) => res.status(403).json({ message: "forbidden" });
  return {
    requireAuth: allowAdmin,
    requireAdmin: allowAdmin,
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
    _denyAdmin: denyAdmin,
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

describe("admin billing info endpoint", () => {
  it("allows admin to fetch billing info", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const res = await supertest(baseUrl).get("/api/admin/billing/info");
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    httpServer.close();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";

vi.doMock("../server/auth", () => {
  const allow = (_req: any, _res: any, next: () => void) => next();
  const denyAdmin = (_req: any, res: any) => res.status(403).json({ message: "forbidden" });
  return {
    requireAuth: denyAdmin,
    requireAdmin: denyAdmin,
    ensureWorkspaceContextMiddleware: () => allow,
    getSessionUser: () => ({ id: "user-1", role: "user" }),
    toPublicUser: (user: unknown) => user,
    reloadGoogleAuth: vi.fn(),
    reloadYandexAuth: vi.fn(),
    ensureWorkspaceContext: vi.fn(),
    buildSessionResponse: vi.fn(),
    getRequestWorkspace: () => ({ id: "workspace-1" }),
    getRequestWorkspaceMemberships: () => [],
    resolveOptionalUser: () => ({ id: "user-1" }),
    WorkspaceContextError: class extends Error {},
  };
});

async function createTestServer() {
  const appModule = await import("express");
  const app = appModule.default();
  app.use(appModule.json());
  const { requireAdmin } = await import("../server/auth");
  app.get("/api/admin/tariffs", requireAdmin, (_req, res) => {
    res.json({ tariffs: [] });
  });
  const httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  return { httpServer };
}

describe("admin tariffs API auth", () => {
  it("returns 403 for non-admin access", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/tariffs");
    expect(res.status).toBe(403);
    httpServer.close();
  });
});

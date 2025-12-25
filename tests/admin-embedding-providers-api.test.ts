import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import express from "express";

const authMock = vi.hoisted(() => ({ allowAdmin: true }));
const registryMock = vi.hoisted(() => ({
  listEmbeddingProvidersWithStatus: vi.fn(async () => [
    {
      id: "p1",
      displayName: "Provider 1",
      providerType: "gigachat",
      model: "text-embedding",
      isActive: true,
      isConfigured: true,
    },
  ]),
}));

vi.doMock("../server/auth", () => {
  const guard = (_req: any, res: any, next: () => void) => {
    if (!authMock.allowAdmin) {
      return res.status(403).json({ message: "forbidden" });
    }
    return next();
  };
  return {
    requireAuth: guard,
    requireAdmin: guard,
    ensureWorkspaceContextMiddleware: () => guard,
    getSessionUser: () => (authMock.allowAdmin ? { id: "admin-1", role: "admin" } : null),
    toPublicUser: (user: unknown) => user,
    reloadGoogleAuth: vi.fn(),
    reloadYandexAuth: vi.fn(),
    ensureWorkspaceContext: vi.fn(),
    buildSessionResponse: vi.fn(),
    getRequestWorkspace: () => ({ id: "workspace-1" }),
    getRequestWorkspaceMemberships: () => [],
    resolveOptionalUser: () => ({ id: "admin-1" }),
    WorkspaceContextError: class extends Error {},
  };
});

vi.doMock("../server/embedding-provider-registry", () => registryMock);

async function createTestServer() {
  const { requireAdmin, getRequestWorkspace } = await import("../server/auth");
  const { listEmbeddingProvidersWithStatus } = await import("../server/embedding-provider-registry");
  const app = express();
  app.use(express.json());

  app.get("/api/admin/embeddings/providers", requireAdmin, async (req, res, next) => {
    try {
      const workspace = getRequestWorkspace(req);
      const providers = await listEmbeddingProvidersWithStatus(workspace?.id);
      res.json({ providers });
    } catch (error) {
      next(error);
    }
  });

  const httpServer = app.listen(0);
  await new Promise<void>((resolve) => (httpServer.listening ? resolve() : httpServer.once("listening", resolve)));
  return { httpServer };
}

afterEach(() => {
  authMock.allowAdmin = true;
  registryMock.listEmbeddingProvidersWithStatus.mockClear();
});

describe("Admin embedding providers API", () => {
  it("возвращает список провайдеров", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/embeddings/providers");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.providers)).toBe(true);
    expect(res.body.providers[0]?.id).toBe("p1");
    expect(registryMock.listEmbeddingProvidersWithStatus).toHaveBeenCalledWith("workspace-1");

    httpServer.close();
  });

  it("запрещает доступ не-админу", async () => {
    authMock.allowAdmin = false;
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/embeddings/providers");

    expect(res.status).toBe(403);
    httpServer.close();
  });
});

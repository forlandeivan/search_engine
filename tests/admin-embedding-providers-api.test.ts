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
  resolveEmbeddingProviderModels: vi.fn(async (providerId: string) =>
    providerId === "p1"
      ? {
          providerId: "p1",
          providerName: "Provider 1",
          supportsModelSelection: true,
          defaultModel: "text-embedding",
          models: ["text-embedding", "text-embedding-3-small"],
          isConfigured: true,
        }
      : null,
  ),
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
  const { listEmbeddingProvidersWithStatus, resolveEmbeddingProviderModels } = await import("../server/embedding-provider-registry");
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

  app.get("/api/admin/embeddings/providers/:providerId/models", requireAdmin, async (req, res, next) => {
    try {
      const workspace = getRequestWorkspace(req);
      const models = await resolveEmbeddingProviderModels(req.params.providerId, workspace?.id);
      if (!models) {
        return res.status(404).json({ message: "Провайдер эмбеддингов не найден", code: "EMBEDDINGS_PROVIDER_UNKNOWN" });
      }
      res.json(models);
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
  registryMock.resolveEmbeddingProviderModels.mockClear();
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

  it("возвращает модели провайдера", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`).get(
      "/api/admin/embeddings/providers/p1/models",
    );

    expect(res.status).toBe(200);
    expect(res.body?.providerId).toBe("p1");
    expect(Array.isArray(res.body?.models)).toBe(true);
    expect(registryMock.resolveEmbeddingProviderModels).toHaveBeenCalledWith("p1", "workspace-1");

    httpServer.close();
  });

  it("возвращает 404 для неизвестного провайдера", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`).get(
      "/api/admin/embeddings/providers/unknown/models",
    );

    expect(res.status).toBe(404);
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

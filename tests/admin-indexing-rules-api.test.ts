import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import express from "express";
import { DEFAULT_INDEXING_RULES, MIN_CHUNK_SIZE, updateIndexingRulesSchema } from "@shared/indexing-rules";

const authMock = vi.hoisted(() => ({ allowAdmin: true }));
const indexingRulesMock = vi.hoisted(() => ({
  getIndexingRules: vi.fn(async () => DEFAULT_INDEXING_RULES),
  updateIndexingRules: vi.fn(async (payload: any) => ({ ...DEFAULT_INDEXING_RULES, ...payload })),
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

vi.doMock("../server/indexing-rules", () => ({
  indexingRulesService: indexingRulesMock,
  IndexingRulesError: class extends Error {},
  IndexingRulesDomainError: class extends Error {
    code = "EMBEDDINGS_PROVIDER_NOT_CONFIGURED";
    field = "embeddings_provider";
    status = 400;
  },
}));

async function createTestServer() {
  const { requireAdmin, getSessionUser, getRequestWorkspace } = await import("../server/auth");
  const { indexingRulesService, IndexingRulesError, IndexingRulesDomainError } = await import("../server/indexing-rules");
  const app = express();
  app.use(express.json());

  app.get("/api/admin/indexing-rules", requireAdmin, async (_req, res, next) => {
    try {
      const rules = await indexingRulesService.getIndexingRules();
      res.json(rules);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/indexing-rules", requireAdmin, async (req, res, next) => {
    try {
      const parsed = updateIndexingRulesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid indexing rules", details: parsed.error.format() });
      }

      const admin = getSessionUser(req);
      if (!admin) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const updated = await indexingRulesService.updateIndexingRules(parsed.data, admin.id, {
        workspaceId: getRequestWorkspace(req)?.id,
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof IndexingRulesDomainError) {
        return res
          .status((error as any).status || 400)
          .json({ message: error.message, code: (error as any).code, field: (error as any).field });
      }
      if (error instanceof IndexingRulesError) {
        return res.status((error as any).status || 400).json({ message: error.message });
      }
      next(error);
    }
  });

  const httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer.listening ? resolve() : httpServer.once("listening", resolve));
  return { httpServer };
}

afterEach(() => {
  authMock.allowAdmin = true;
  indexingRulesMock.getIndexingRules.mockClear();
  indexingRulesMock.updateIndexingRules.mockClear();
});

describe("Admin indexing rules API", () => {
  it("возвращает текущие правила для админа", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/indexing-rules");

    expect(res.status).toBe(200);
    expect(res.body?.chunkSize).toBe(DEFAULT_INDEXING_RULES.chunkSize);
    expect(indexingRulesMock.getIndexingRules).toHaveBeenCalledTimes(1);

    httpServer.close();
  });

  it("запрещает доступ не-админу", async () => {
    authMock.allowAdmin = false;
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/indexing-rules");
    expect(res.status).toBe(403);
    expect(indexingRulesMock.getIndexingRules).not.toHaveBeenCalled();

    httpServer.close();
  });

  it("сохраняет валидные правила", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const payload = { chunkSize: 900, chunkOverlap: 100, topK: 5, relevanceThreshold: 0.4 };
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/indexing-rules")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body?.chunkSize).toBe(900);
    expect(indexingRulesMock.updateIndexingRules).toHaveBeenCalledTimes(1);
    expect(indexingRulesMock.updateIndexingRules).toHaveBeenCalledWith(
      expect.objectContaining(payload),
      "admin-1",
      expect.objectContaining({ workspaceId: "workspace-1" }),
    );

    httpServer.close();
  });

  it("возвращает 400 при невалидных данных", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/indexing-rules")
      .send({ chunkSize: 100, chunkOverlap: 200 });

    expect(res.status).toBe(400);
    expect(indexingRulesMock.updateIndexingRules).not.toHaveBeenCalled();

    httpServer.close();
  });

  it("возвращает ошибку по chunk_size если ниже минимума", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/indexing-rules")
      .send({ chunkSize: MIN_CHUNK_SIZE - 1 });

    expect(res.status).toBe(400);

    httpServer.close();
  });

  it("прокидывает доменную ошибку провайдера", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const { IndexingRulesDomainError } = await import("../server/indexing-rules");
    const domainError = Object.assign(new IndexingRulesDomainError("provider not configured"), {
      code: "EMBEDDINGS_PROVIDER_NOT_CONFIGURED",
      field: "embeddings_provider",
      status: 400,
    });
    indexingRulesMock.updateIndexingRules.mockRejectedValueOnce(domainError);

    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/indexing-rules")
      .send({ embeddingsProvider: "p1" });

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("EMBEDDINGS_PROVIDER_NOT_CONFIGURED");

    httpServer.close();
  });
});

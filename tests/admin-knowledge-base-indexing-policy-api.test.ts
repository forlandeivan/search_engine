import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import supertest from "supertest";
import express from "express";
import {
  DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY,
  knowledgeBaseIndexingPolicySchema,
  updateKnowledgeBaseIndexingPolicySchema,
} from "@shared/knowledge-base-indexing-policy";

const authMock = vi.hoisted(() => ({ allowAdmin: true }));
const policyMock = vi.hoisted(() => {
  let state = { ...DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY };
  return {
    get: vi.fn(async () => state),
    update: vi.fn(async (payload: any, adminId: string | null) => {
      const next = { ...state, ...payload };
      if (next.chunkOverlap >= next.chunkSize) {
        const error = new (class extends Error {
          code = "CHUNK_OVERLAP_TOO_LARGE";
          field = "chunkOverlap";
          status = 400;
        })("chunkOverlap >= chunkSize");
        throw error;
      }
      state = next;
      return state;
    }),
    reset: () => {
      state = { ...DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY };
    },
  };
});

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

vi.doMock("../server/knowledge-base-indexing-policy", () => ({
  knowledgeBaseIndexingPolicyService: policyMock,
  KnowledgeBaseIndexingPolicyError: class extends Error {},
  KnowledgeBaseIndexingPolicyDomainError: class extends Error {
    code = "PROVIDER_UNAVAILABLE";
    field = "embeddingsProvider";
    status = 400;
  },
}));

async function createTestServer() {
  const { requireAdmin, getSessionUser, getRequestWorkspace } = await import("../server/auth");
  const {
    knowledgeBaseIndexingPolicyService,
    KnowledgeBaseIndexingPolicyError,
    KnowledgeBaseIndexingPolicyDomainError,
  } = await import("../server/knowledge-base-indexing-policy");
  const app = express();
  app.use(express.json());

  app.get("/api/admin/knowledge-base-indexing-policy", requireAdmin, async (_req, res, next) => {
    try {
      const policy = await knowledgeBaseIndexingPolicyService.get();
      res.json(policy);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/knowledge-base-indexing-policy", requireAdmin, async (req, res, next) => {
    try {
      const parsed = knowledgeBaseIndexingPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid knowledge base indexing policy",
          code: "KNOWLEDGE_BASE_INDEXING_POLICY_INVALID",
          details: parsed.error.format(),
        });
      }

      const admin = getSessionUser(req);
      if (!admin) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const workspace = getRequestWorkspace(req);
      const updated = await knowledgeBaseIndexingPolicyService.update(parsed.data, admin.id, workspace?.id);
      res.json(updated);
    } catch (error) {
      if (error instanceof KnowledgeBaseIndexingPolicyDomainError) {
        return res
          .status(error.status || 400)
          .json({ message: error.message, code: error.code, field: error.field ?? "embeddingsProvider" });
      }
      if (error instanceof KnowledgeBaseIndexingPolicyError) {
        return res.status(error.status || 400).json({ message: error.message });
      }
      next(error);
    }
  });

  app.patch("/api/admin/knowledge-base-indexing-policy", requireAdmin, async (req, res, next) => {
    try {
      const parsed = updateKnowledgeBaseIndexingPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid knowledge base indexing policy update",
          code: "KNOWLEDGE_BASE_INDEXING_POLICY_INVALID",
          details: parsed.error.format(),
        });
      }

      const admin = getSessionUser(req);
      if (!admin) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const workspace = getRequestWorkspace(req);
      const updated = await knowledgeBaseIndexingPolicyService.update(parsed.data, admin.id, workspace?.id);
      res.json(updated);
    } catch (error) {
      if (error instanceof KnowledgeBaseIndexingPolicyDomainError) {
        return res
          .status(error.status || 400)
          .json({ message: error.message, code: error.code, field: error.field ?? "embeddingsProvider" });
      }
      if (error instanceof KnowledgeBaseIndexingPolicyError) {
        return res.status(error.status || 400).json({ message: error.message });
      }
      next(error);
    }
  });

  const httpServer = app.listen(0);
  await new Promise<void>((resolve) => (httpServer.listening ? resolve() : httpServer.once("listening", resolve)));
  return { httpServer };
}

afterEach(() => {
  authMock.allowAdmin = true;
  policyMock.get.mockClear();
  policyMock.update.mockClear();
  policyMock.reset();
});

describe("Admin knowledge base indexing policy API", () => {
  it("возвращает текущую политику для админа", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/knowledge-base-indexing-policy");

    expect(res.status).toBe(200);
    expect(res.body?.chunkSize).toBe(DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY.chunkSize);
    expect(res.body?.embeddingsProvider).toBeDefined();
    expect(policyMock.get).toHaveBeenCalledTimes(1);

    httpServer.close();
  });

  it("запрещает доступ не-админу", async () => {
    authMock.allowAdmin = false;
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/knowledge-base-indexing-policy");
    expect(res.status).toBe(403);
    expect(policyMock.get).not.toHaveBeenCalled();

    httpServer.close();
  });

  it("сохраняет валидную политику через PATCH", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const payload = {
      embeddingsProvider: "test-provider-id",
      embeddingsModel: "text-embedding-3-small",
      chunkSize: 1200,
      chunkOverlap: 150,
      defaultSchema: [{ name: "content", type: "string", isArray: false, template: "{{ chunk.text }}" }],
    };
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/knowledge-base-indexing-policy")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body?.chunkSize).toBe(1200);
    expect(res.body?.embeddingsProvider).toBe("test-provider-id");
    expect(policyMock.update).toHaveBeenCalledTimes(1);
    expect(policyMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkSize: 1200,
        chunkOverlap: 150,
      }),
      "admin-1",
      { id: "workspace-1" },
    );

    httpServer.close();
  });

  it("сохраняет валидную политику через PUT", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const payload = {
      ...DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY,
      chunkSize: 1000,
      chunkOverlap: 200,
    };
    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .put("/api/admin/knowledge-base-indexing-policy")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body?.chunkSize).toBe(1000);
    expect(res.body?.chunkOverlap).toBe(200);

    const after = await supertest(`http://127.0.0.1:${address.port}`).get("/api/admin/knowledge-base-indexing-policy");
    expect(after.body?.chunkSize).toBe(1000);

    httpServer.close();
  });

  it("возвращает 400 при невалидных данных", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;

    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/knowledge-base-indexing-policy")
      .send({ chunkSize: 100, chunkOverlap: 200 });

    expect(res.status).toBe(400);
    expect(policyMock.update).not.toHaveBeenCalled();

    httpServer.close();
  });

  it("прокидывает доменную ошибку провайдера", async () => {
    const { httpServer } = await createTestServer();
    const address = httpServer.address() as AddressInfo;
    const { KnowledgeBaseIndexingPolicyDomainError } = await import("../server/knowledge-base-indexing-policy");
    const domainError = Object.assign(new KnowledgeBaseIndexingPolicyDomainError("provider unavailable"), {
      code: "PROVIDER_UNAVAILABLE",
      field: "embeddingsProvider",
      status: 400,
    });
    policyMock.update.mockRejectedValueOnce(domainError);

    const res = await supertest(`http://127.0.0.1:${address.port}`)
      .patch("/api/admin/knowledge-base-indexing-policy")
      .send({
        embeddingsProvider: "unavailable-provider",
        embeddingsModel: "model-1",
      });

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(res.body?.field).toBe("embeddingsProvider");

    httpServer.close();
  });
});


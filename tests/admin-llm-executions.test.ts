import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import type { SkillExecutionStatus } from "../server/skill-execution-log";
import type { SkillExecutionLogService } from "../server/skill-execution-log-service";

const executeMock = vi.fn<(query: unknown) => Promise<{ rows: Record<string, unknown>[] }>>();

function setupDbMock(): void {
  vi.doMock("../server/db", () => ({
    db: {
      execute: (...args: [unknown]) => executeMock(...args),
    },
    pool: null,
    isDatabaseConfigured: true,
  }));
}

function setupAuthMock(options: { allowAdmin?: boolean } = {}): void {
  const allowAdmin = options.allowAdmin ?? true;
  vi.doMock("../server/auth", () => {
    const requireAuth = (_req: any, _res: any, next: () => void) => next();
    const requireAdmin = allowAdmin
      ? requireAuth
      : (_req: any, res: any) => res.status(403).json({ message: "forbidden" });

    return {
      requireAuth,
      requireAdmin,
      getSessionUser: () => ({ id: "user-1", email: "user@example.com" }),
      toPublicUser: (user: unknown) => user,
      reloadGoogleAuth: vi.fn(),
      reloadYandexAuth: vi.fn(),
      ensureWorkspaceContext: vi.fn(() => ({
        active: { id: "workspace-1", role: "owner" },
        memberships: [{ id: "workspace-1", role: "owner" }],
      })),
      buildSessionResponse: vi.fn(() => ({
        user: { id: "user-1" },
        workspace: { active: { id: "workspace-1", role: "owner" }, memberships: [] },
      })),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => [],
      resolveOptionalUser: () => ({ id: "user-1" }),
      WorkspaceContextError: class extends Error {},
    };
  });
}

function setupStorageMock() {
  type MockInstance = ReturnType<typeof vi.fn>;
  const methodMocks: Record<string | symbol, MockInstance> = {};
  const storageProxy = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (!methodMocks[prop]) {
          methodMocks[prop] = vi.fn();
        }
        return methodMocks[prop]!;
      },
    },
  );

  vi.doMock("../server/storage", () => ({
    storage: storageProxy,
  }));

  return storageProxy as Record<string | symbol, MockInstance>;
}

function setupSkillsMock() {
  const listSkills = vi.fn();
  const createSkill = vi.fn();
  const updateSkill = vi.fn();
  const deleteSkill = vi.fn();
  const getSkillById = vi.fn();
  const createUnicaChatSkillForWorkspace = vi.fn();

  class SkillServiceError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }

  vi.doMock("../server/skills", () => ({
    listSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    SkillServiceError,
    getSkillById,
    UNICA_CHAT_SYSTEM_KEY: "UNICA_CHAT",
    createUnicaChatSkillForWorkspace,
  }));

  return { getSkillById };
}

async function createTestServer() {
  const expressModule = await import("express");
  const app = expressModule.default();
  app.use(expressModule.json());
  const { registerRoutes } = await import("../server/routes");
  const httpServer = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  return { httpServer };
}

async function seedExecution(
  service: SkillExecutionLogService,
  options: {
    workspaceId?: string;
    userId?: string | null;
    skillId?: string;
    chatId?: string | null;
    status?: SkillExecutionStatus;
    hasError?: boolean;
    userMessageId?: string | null;
  } = {},
) {
  const execution = await service.startExecution({
    workspaceId: options.workspaceId ?? "workspace-1",
    userId: options.userId ?? "user-1",
    skillId: options.skillId ?? "skill-1",
    chatId: options.chatId ?? "chat-1",
    source: "workspace_skill",
  });
  if (!execution) {
    throw new Error("Logging disabled");
  }
  await service.logStep({
    executionId: execution.id,
    type: "RECEIVE_HTTP_REQUEST",
    status: "success",
  });
  await service.logStep({
    executionId: execution.id,
    type: "CALL_LLM",
    status: options.hasError ? "error" : "success",
    errorMessage: options.hasError ? "LLM error" : undefined,
  });
  await service.finishExecution(execution.id, options.status ?? (options.hasError ? "error" : "success"), {
    userMessageId: options.userMessageId ?? null,
  });
  return execution.id;
}

beforeEach(() => {
  vi.resetModules();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin llm executions API", () => {
  it(
    "returns paginated executions with filters",
    async () => {
      setupDbMock();
      setupAuthMock();
      const storageMock = setupStorageMock();
      const skillsMock = setupSkillsMock();

    const { skillExecutionLogService, __resetSkillExecutionLogsForTests } = await import(
      "../server/skill-execution-log-context"
    );
    __resetSkillExecutionLogsForTests();

    skillsMock.getSkillById.mockImplementation(async () => ({
      id: "skill-1",
      name: "Test Skill",
      isSystem: false,
    }));
    storageMock.getWorkspace.mockImplementation(async (id: string) => ({ id, name: `Workspace ${id}` }));
    storageMock.getUser.mockImplementation(async (id: string) => ({
      id,
      email: `${id}@example.com`,
      name: `User ${id}`,
    }));
    storageMock.getChatMessage.mockImplementation(async (id: string) => ({
      id,
      chatId: "chat-1",
      role: "user",
      content: `Message ${id}`,
      metadata: {},
      createdAt: new Date().toISOString(),
    }));

    const successId = await seedExecution(skillExecutionLogService, {
      workspaceId: "workspace-1",
      userMessageId: "msg-success",
    });
    const errorId = await seedExecution(skillExecutionLogService, {
      workspaceId: "workspace-2",
      status: "error",
      hasError: true,
      userMessageId: "msg-error",
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/llm-executions?status=success&pageSize=5`,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        items: Array<{ id: string; userMessagePreview: string | null }>;
        total: number;
      };
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0].id).toBe(successId);
      expect(payload.items[0].userMessagePreview).toBe("Message msg-success");

      const errorResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/llm-executions?hasError=true`,
      );
      expect(errorResponse.status).toBe(200);
      const errorPayload = (await errorResponse.json()) as { items: Array<{ id: string }> };
      expect(errorPayload.items).toHaveLength(1);
      expect(errorPayload.items[0].id).toBe(errorId);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  },
    15_000,
  );

  it("returns execution detail with steps", async () => {
    setupDbMock();
    setupAuthMock();
    const storageMock = setupStorageMock();
    const skillsMock = setupSkillsMock();

    const { skillExecutionLogService, __resetSkillExecutionLogsForTests } = await import(
      "../server/skill-execution-log-context"
    );
    __resetSkillExecutionLogsForTests();

    skillsMock.getSkillById.mockResolvedValue({
      id: "skill-1",
      name: "Test Skill",
      isSystem: false,
    });
    storageMock.getWorkspace.mockResolvedValue({ id: "workspace-1", name: "Workspace 1" });
    storageMock.getUser.mockResolvedValue({ id: "user-1", email: "user@example.com", name: "User 1" });
    storageMock.getChatMessage.mockResolvedValue({
      id: "msg-success",
      chatId: "chat-1",
      role: "user",
      content: "Hello there",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    const executionId = await seedExecution(skillExecutionLogService, {
      userMessageId: "msg-success",
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/llm-executions/${executionId}`,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        execution: { id: string };
        steps: Array<{ type: string; status: string }>;
      };
      expect(payload.execution.id).toBe(executionId);
      expect(payload.steps.length).toBeGreaterThan(0);
      expect(payload.steps[0].type).toBe("RECEIVE_HTTP_REQUEST");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects access without admin rights", async () => {
    setupDbMock();
    setupAuthMock({ allowAdmin: false });
    setupStorageMock();
    setupSkillsMock();

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/llm-executions`);
      expect(response.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

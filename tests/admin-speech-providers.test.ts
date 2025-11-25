import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import type { SpeechProvider, SpeechProviderSecret } from "@shared/schema";

const executeMock = vi.fn<(query: unknown) => Promise<{ rows: Record<string, unknown>[] }>>();

/**
 * Manual verification checklist:
 * 1. Авторизоваться как администратор и открыть GET /api/admin/tts-stt/providers — список должен содержать Yandex SpeechKit.
 * 2. Проверить, что limit/offset вне диапазона дают 400 с сообщением про поле.
 * 3. В карточке провайдера (GET /api/admin/tts-stt/providers/:id) отображаются статус, конфиг и отметка о секретах.
 * 4. PATCH /api/admin/tts-stt/providers/:id с валидными секретами и languageCode включает провайдера, в логах появляется запись.
 * 5. Повторять PATCH >30 раз в минуту нельзя — получаем 429 Rate limit exceeded.
 */

function setupDbMock(): void {
  vi.doMock("../server/db", () => ({
    db: {
      execute: (...args: [unknown]) => executeMock(...args),
    },
    pool: null,
    isDatabaseConfigured: true,
  }));
}

function setupAuthMock(options: { allowAdmin?: boolean; adminId?: string } = {}): void {
  const allowAdmin = options.allowAdmin ?? true;
  const adminId = options.adminId ?? "admin-1";
  vi.doMock("../server/auth", () => {
    const requireAuth = (_req: any, _res: any, next: () => void) => next();
    const requireAdmin = allowAdmin
      ? requireAuth
      : (_req: any, res: any) => res.status(403).json({ message: "Access denied" });

    return {
      requireAuth,
      requireAdmin,
      getSessionUser: () => ({ id: adminId, email: "admin@example.com", role: "admin" }),
      toPublicUser: (user: unknown) => user,
      reloadGoogleAuth: vi.fn(),
      reloadYandexAuth: vi.fn(),
      ensureWorkspaceContext: vi.fn(() => ({
        active: { id: "workspace-1", role: "owner" },
        memberships: [{ id: "workspace-1", role: "owner" }],
      })),
      buildSessionResponse: vi.fn(() => ({
        user: { id: adminId },
        workspace: { active: { id: "workspace-1", role: "owner" }, memberships: [] },
      })),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => [],
      resolveOptionalUser: () => ({ id: adminId }),
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

async function createTestServer() {
  const expressModule = await import("express");
  const app = expressModule.default();
  app.use(expressModule.json());
  const { registerRoutes, __resetSpeechProviderRateLimitForTests } = await import("../server/routes");
  __resetSpeechProviderRateLimitForTests();
  const httpServer = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  return { httpServer };
}

function createSpeechProvider(overrides: Partial<SpeechProvider> = {}): SpeechProvider {
  const now = new Date().toISOString();
  return {
    id: "yandex_speechkit",
    displayName: "Yandex SpeechKit",
    providerType: "stt",
    direction: "audio_to_text",
    isEnabled: false,
    status: "Disabled",
    lastStatusChangedAt: null,
    lastValidationAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    configJson: {},
    isBuiltIn: true,
    updatedByAdminId: "admin-2",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createSecret(overrides: Partial<SpeechProviderSecret> = {}): SpeechProviderSecret {
  return {
    providerId: "yandex_speechkit",
    secretKey: "apiKey",
    secretValue: "value",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin speech provider API", () => {
  it("returns provider list with pagination and metadata", async () => {
    setupDbMock();
    setupAuthMock();
    const storageMock = setupStorageMock();
    const provider = createSpeechProvider();
    storageMock.listSpeechProviders.mockResolvedValue([provider]);
    storageMock.getUser.mockResolvedValue({ id: provider.updatedByAdminId, email: "last@example.com" });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers?limit=10&offset=0`,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        providers: Array<{ id: string; updatedByAdmin: { id: string; email: string | null } | null }>;
        total: number;
        limit: number;
        offset: number;
      };
      expect(payload.total).toBe(1);
      expect(payload.limit).toBe(10);
      expect(payload.providers).toHaveLength(1);
      expect(payload.providers[0].id).toBe(provider.id);
      expect(payload.providers[0].updatedByAdmin?.email).toBe("last@example.com");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("validates limit parameter", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers?limit=5000`,
      );
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { message: string };
      expect(payload.message).toBe("Invalid value for field 'limit'");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns provider detail", async () => {
    setupDbMock();
    setupAuthMock();
    const storageMock = setupStorageMock();
    const provider = createSpeechProvider({ updatedByAdminId: "admin-3" });
    storageMock.getSpeechProvider
      .mockResolvedValueOnce(provider)
      .mockResolvedValueOnce({ ...provider, status: "Enabled", isEnabled: true });
    storageMock.getSpeechProviderSecrets.mockResolvedValue([
      createSecret({ secretKey: "apiKey", secretValue: "token" }),
      createSecret({ secretKey: "folderId", secretValue: "folder" }),
    ]);
    storageMock.getUser.mockResolvedValue({ id: "admin-3", email: "meta@example.com" });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers/${provider.id}`,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { provider: { id: string; secrets: Record<string, { isSet: boolean }> } };
      expect(payload.provider.id).toBe(provider.id);
      expect(payload.provider.secrets.apiKey.isSet).toBe(true);
      expect(payload.provider.secrets.folderId.isSet).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns 404 for missing provider detail", async () => {
    setupDbMock();
    setupAuthMock();
    const storageMock = setupStorageMock();
    storageMock.getSpeechProvider.mockResolvedValue(undefined);

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers/yandex_speechkit`,
      );
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("updates provider configuration and secrets", async () => {
    setupDbMock();
    setupAuthMock();
    const storageMock = setupStorageMock();
    const baseProvider = createSpeechProvider({ updatedByAdminId: null });
    const enabledProvider = createSpeechProvider({
      isEnabled: true,
      status: "Enabled",
      updatedByAdminId: "admin-1",
      configJson: { languageCode: "ru-RU", enablePunctuation: true },
    });

    storageMock.getSpeechProvider
      .mockResolvedValueOnce(baseProvider)
      .mockResolvedValueOnce(enabledProvider)
      .mockResolvedValueOnce(enabledProvider);
    storageMock.getSpeechProviderSecrets
      .mockResolvedValueOnce([createSecret({ secretKey: "apiKey", secretValue: "" })])
      .mockResolvedValueOnce([
        createSecret({ secretKey: "apiKey", secretValue: "token" }),
        createSecret({ secretKey: "folderId", secretValue: "folder" }),
      ])
      .mockResolvedValueOnce([
        createSecret({ secretKey: "apiKey", secretValue: "token" }),
        createSecret({ secretKey: "folderId", secretValue: "folder" }),
      ]);
    storageMock.updateSpeechProvider.mockResolvedValue(enabledProvider);
    storageMock.upsertSpeechProviderSecret.mockResolvedValue(undefined);
    storageMock.deleteSpeechProviderSecret.mockResolvedValue(undefined);
    storageMock.getUser.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers/${baseProvider.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isEnabled: true,
            config: { languageCode: "ru-RU", enablePunctuation: true },
            secrets: { apiKey: "token", folderId: "folder" },
          }),
        },
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { provider: { status: string; updatedByAdmin: { id: string } | null } };
      expect(payload.provider.status).toBe("Enabled");
      expect(payload.provider.updatedByAdmin?.id).toBe("admin-1");
      expect(storageMock.upsertSpeechProviderSecret).toHaveBeenCalledWith(baseProvider.id, "apiKey", "token");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("blocks enabling provider without required secrets", async () => {
    setupDbMock();
    setupAuthMock();
    const storageMock = setupStorageMock();
    const baseProvider = createSpeechProvider();
    storageMock.getSpeechProvider.mockResolvedValue(baseProvider);
    storageMock.getSpeechProviderSecrets.mockResolvedValue([]);

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers/${baseProvider.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isEnabled: true,
            config: { languageCode: "ru-RU" },
          }),
        },
      );
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { message: string };
      expect(payload.message).toBe("Secret 'apiKey' must be set before enabling provider");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("enforces rate limit for provider updates", async () => {
    setupDbMock();
    setupAuthMock({ adminId: "admin-rate" });
    const storageMock = setupStorageMock();
    const baseProvider = createSpeechProvider({ updatedByAdminId: "admin-rate" });
    storageMock.getSpeechProvider.mockResolvedValue(baseProvider);
    storageMock.getSpeechProviderSecrets.mockResolvedValue([]);
    storageMock.getUser.mockResolvedValue({ id: "admin-rate", email: "rate@example.com" });

    const routesModule = await import("../server/routes");
    routesModule.__resetSpeechProviderRateLimitForTests();
    routesModule.__seedSpeechProviderRateLimitForTests(
      "admin-rate",
      Array.from({ length: 30 }, () => Date.now()),
    );
    const expressModule = await import("express");
    const app = expressModule.default();
    app.use(expressModule.json());
    const httpServer = await routesModule.registerRoutes(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/tts-stt/providers/${baseProvider.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { languageCode: "ru-RU" } }),
        },
      );
      expect(response.status).toBe(429);
      const payload = (await response.json()) as { message: string };
      expect(payload.message).toBe("Rate limit exceeded");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

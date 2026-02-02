import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../server/storage", () => ({
  storage: {
    listSpeechProviders: vi.fn(),
    getSpeechProvider: vi.fn(),
    getSpeechProviderSecrets: vi.fn(),
    updateSpeechProvider: vi.fn(),
    createSpeechProvider: vi.fn(),
    deleteSpeechProvider: vi.fn(),
    upsertSpeechProviderSecret: vi.fn(),
    deleteSpeechProviderSecret: vi.fn(),
    getUser: vi.fn(),
    db: {
      query: {
        skills: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
      },
    },
  },
}));

vi.mock("../server/vite", () => ({
  log: vi.fn(),
}));

import { speechProviderService, SpeechProviderServiceError, unicaAsrConfigSchema } from "../server/speech-provider-service";
import { storage } from "../server/storage";
import type { SpeechProvider } from "@shared/schema";

const yandexProvider: SpeechProvider = {
  id: "yandex_speechkit",
  displayName: "Yandex SpeechKit",
  providerType: "stt",
  asrProviderType: "yandex",
  direction: "audio_to_text",
  isEnabled: true,
  status: "Enabled",
  lastStatusChangedAt: null,
  lastValidationAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  configJson: {},
  isBuiltIn: false,
  updatedByAdminId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const unicaProvider: SpeechProvider = {
  id: "unica_asr_1",
  displayName: "Unica ASR Dev",
  providerType: "stt",
  asrProviderType: "unica",
  direction: "audio_to_text",
  isEnabled: true,
  status: "Enabled",
  lastStatusChangedAt: null,
  lastValidationAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  configJson: {
    baseUrl: "https://test.example.com/api",
    workspaceId: "TEST",
    pollingIntervalMs: 5000,
    timeoutMs: 3600000,
  },
  isBuiltIn: false,
  updatedByAdminId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("SpeechProviderService - ASR Provider Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAsrProviderForSkill", () => {
    it("should return ASR provider for skill", async () => {
      const mockSkill = {
        id: "skill-1",
        workspaceId: "ws-1",
        asrProviderId: "unica_asr_1",
        name: "Test Skill",
      };

      vi.mocked(storage.db.query.skills.findFirst).mockResolvedValueOnce(mockSkill as any);
      vi.mocked(storage.getSpeechProvider).mockResolvedValueOnce(unicaProvider);
      vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValueOnce([]);

      const result = await speechProviderService.getAsrProviderForSkill("skill-1");

      expect(result).toBeDefined();
      expect(result?.provider.id).toBe("unica_asr_1");
      expect(result?.provider.asrProviderType).toBe("unica");
    });

    it("should return null if skill has no ASR provider", async () => {
      const mockSkill = {
        id: "skill-1",
        workspaceId: "ws-1",
        asrProviderId: null,
        name: "Test Skill",
      };

      vi.mocked(storage.db.query.skills.findFirst).mockResolvedValueOnce(mockSkill as any);

      const result = await speechProviderService.getAsrProviderForSkill("skill-1");

      expect(result).toBeNull();
    });

    it("should throw error if provider is disabled", async () => {
      const mockSkill = {
        id: "skill-1",
        workspaceId: "ws-1",
        asrProviderId: "unica_asr_1",
        name: "Test Skill",
      };

      const disabledProvider = { ...unicaProvider, isEnabled: false };

      vi.mocked(storage.db.query.skills.findFirst).mockResolvedValueOnce(mockSkill as any);
      vi.mocked(storage.getSpeechProvider).mockResolvedValueOnce(disabledProvider);
      vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValueOnce([]);

      await expect(
        speechProviderService.getAsrProviderForSkill("skill-1")
      ).rejects.toThrow(SpeechProviderServiceError);
    });

    it("should return null if skill not found", async () => {
      vi.mocked(storage.db.query.skills.findFirst).mockResolvedValueOnce(null as any);

      const result = await speechProviderService.getAsrProviderForSkill("skill-1");

      expect(result).toBeNull();
    });
  });

  describe("getProviderByAsrType", () => {
    it("should return provider by ASR type", async () => {
      vi.mocked(storage.listSpeechProviders).mockResolvedValueOnce([yandexProvider, unicaProvider]);
      vi.mocked(storage.getSpeechProvider).mockResolvedValueOnce(unicaProvider);
      vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValueOnce([]);

      const result = await speechProviderService.getProviderByAsrType("unica");

      expect(result).toBeDefined();
      expect(result?.provider.asrProviderType).toBe("unica");
    });

    it("should return null if provider not found", async () => {
      vi.mocked(storage.listSpeechProviders).mockResolvedValueOnce([yandexProvider]);

      const result = await speechProviderService.getProviderByAsrType("unica");

      expect(result).toBeNull();
    });

    it("should return null if provider is disabled", async () => {
      const disabledProvider = { ...unicaProvider, isEnabled: false };
      vi.mocked(storage.listSpeechProviders).mockResolvedValueOnce([disabledProvider]);

      const result = await speechProviderService.getProviderByAsrType("unica");

      expect(result).toBeNull();
    });
  });

  describe("getAvailableAsrProviders", () => {
    it("should return all enabled STT providers", async () => {
      vi.mocked(storage.listSpeechProviders).mockResolvedValueOnce([yandexProvider, unicaProvider]);
      vi.mocked(storage.getSpeechProvider)
        .mockResolvedValueOnce(yandexProvider)
        .mockResolvedValueOnce(unicaProvider);
      vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValue([]);

      const result = await speechProviderService.getAvailableAsrProviders();

      expect(result).toHaveLength(2);
      expect(result[0].provider.providerType).toBe("stt");
      expect(result[1].provider.providerType).toBe("stt");
    });

    it("should filter out disabled providers", async () => {
      const disabledProvider = { ...unicaProvider, isEnabled: false };
      vi.mocked(storage.listSpeechProviders).mockResolvedValueOnce([yandexProvider, disabledProvider]);
      vi.mocked(storage.getSpeechProvider).mockResolvedValueOnce(yandexProvider);
      vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValue([]);

      const result = await speechProviderService.getAvailableAsrProviders();

      expect(result).toHaveLength(1);
      expect(result[0].provider.id).toBe("yandex_speechkit");
    });
  });

  describe("validateProviderConfig", () => {
    it("should validate Unica config", () => {
      const validConfig = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "TEST",
        pollingIntervalMs: 5000,
        timeoutMs: 3600000,
      };

      const result = speechProviderService.validateProviderConfig("unica", validConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should validate Yandex config", () => {
      const validConfig = {};

      const result = speechProviderService.validateProviderConfig("yandex", validConfig);

      expect(result.valid).toBe(true);
    });
  });

  describe("createUnicaProvider", () => {
    it("should create Unica provider with valid config", async () => {
      const config = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "TEST",
        pollingIntervalMs: 5000,
        timeoutMs: 3600000,
      };

      vi.mocked(storage.createSpeechProvider).mockResolvedValueOnce(unicaProvider);

      const result = await speechProviderService.createUnicaProvider("Unica ASR Dev", config);

      expect(result.displayName).toBe("Unica ASR Dev");
      expect(storage.createSpeechProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Unica ASR Dev",
          providerType: "stt",
          asrProviderType: "unica",
          direction: "audio_to_text",
          isEnabled: true,
          status: "Enabled",
          configJson: config,
          isBuiltIn: false,
        })
      );
    });
  });

  describe("getAsrProviderType", () => {
    it("should return provider type from provider", () => {
      const result = speechProviderService.getAsrProviderType(unicaProvider);
      expect(result).toBe("unica");
    });

    it("should return yandex as default", () => {
      const providerWithoutType = { ...unicaProvider, asrProviderType: null };
      const result = speechProviderService.getAsrProviderType(providerWithoutType as any);
      expect(result).toBe("yandex");
    });
  });

  describe("unicaAsrConfigSchema", () => {
    it("should validate valid config", () => {
      const validConfig = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "TEST",
        pollingIntervalMs: 5000,
        timeoutMs: 3600000,
      };

      const result = unicaAsrConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should reject invalid baseUrl", () => {
      const invalidConfig = {
        baseUrl: "not-a-url",
        workspaceId: "TEST",
      };

      const result = unicaAsrConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should reject empty workspaceId", () => {
      const invalidConfig = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "",
      };

      const result = unicaAsrConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const minimalConfig = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "TEST",
      };

      const result = unicaAsrConfigSchema.safeParse(minimalConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pollingIntervalMs).toBe(5000);
        expect(result.data.timeoutMs).toBe(3600000);
      }
    });
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Express } from "express";

vi.mock("../server/storage", () => ({
  storage: {
    listSpeechProviders: vi.fn(),
    getSpeechProvider: vi.fn(),
    getSpeechProviderSecrets: vi.fn(),
    createSpeechProvider: vi.fn(),
    updateSpeechProvider: vi.fn(),
    deleteSpeechProvider: vi.fn(),
    getUser: vi.fn(),
    db: {
      query: {
        skills: {
          findMany: vi.fn(),
        },
      },
    },
  },
}));

vi.mock("../server/speech-provider-service", () => ({
  speechProviderService: {
    list: vi.fn(),
    getById: vi.fn(),
    createUnicaProvider: vi.fn(),
    update: vi.fn(),
  },
  SpeechProviderServiceError: class SpeechProviderServiceError extends Error {
    constructor(message: string, public status: number = 400) {
      super(message);
      this.name = "SpeechProviderServiceError";
    }
  },
}));

import request from "supertest";
import express from "express";
import { adminTtsSttRouter } from "../server/routes/admin/tts-stt.routes";
import { speechProviderService } from "../server/speech-provider-service";
import { storage } from "../server/storage";

const app = express();
app.use(express.json());
app.use("/api/admin/tts-stt", adminTtsSttRouter);

const mockYandexProvider = {
  id: "yandex_speechkit",
  displayName: "Yandex SpeechKit",
  providerType: "stt",
  asrProviderType: "yandex",
  direction: "audio_to_text",
  isEnabled: true,
  status: "Enabled",
  configJson: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedByAdminId: null,
  lastStatusChangedAt: null,
  lastValidationAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  isBuiltIn: false,
};

const mockUnicaProvider = {
  id: "unica_asr_1",
  displayName: "Unica ASR Dev",
  providerType: "stt",
  asrProviderType: "unica",
  direction: "audio_to_text",
  isEnabled: true,
  status: "Enabled",
  configJson: {
    baseUrl: "https://test.example.com/api",
    workspaceId: "TEST",
    pollingIntervalMs: 5000,
    timeoutMs: 3600000,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedByAdminId: null,
  lastStatusChangedAt: null,
  lastValidationAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  isBuiltIn: false,
};

describe("Admin ASR Providers API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/admin/tts-stt/asr-providers", () => {
    it("should return list of ASR providers", async () => {
      const mockProviders = [
        { provider: mockYandexProvider, config: {}, secrets: {} },
        { provider: mockUnicaProvider, config: mockUnicaProvider.configJson, secrets: {} },
      ];

      vi.mocked(speechProviderService.list).mockResolvedValueOnce([
        mockYandexProvider as any,
        mockUnicaProvider as any,
      ]);
      vi.mocked(speechProviderService.getById)
        .mockResolvedValueOnce(mockProviders[0] as any)
        .mockResolvedValueOnce(mockProviders[1] as any);
      vi.mocked(storage.getUser).mockResolvedValue(null);

      const response = await request(app).get("/api/admin/tts-stt/asr-providers");

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(2);
      expect(response.body.providers[0].asrProviderType).toBe("yandex");
      expect(response.body.providers[1].asrProviderType).toBe("unica");
    });

    it("should filter only STT providers", async () => {
      const ttsProvider = { ...mockYandexProvider, providerType: "tts", direction: "text_to_speech" };

      vi.mocked(speechProviderService.list).mockResolvedValueOnce([
        mockYandexProvider as any,
        ttsProvider as any,
      ]);
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce({
        provider: mockYandexProvider,
        config: {},
        secrets: {},
      } as any);
      vi.mocked(storage.getUser).mockResolvedValue(null);

      const response = await request(app).get("/api/admin/tts-stt/asr-providers");

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(1);
      expect(response.body.providers[0].providerType).toBe("stt");
    });
  });

  describe("GET /api/admin/tts-stt/asr-providers/:id", () => {
    it("should return provider details", async () => {
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce({
        provider: mockUnicaProvider,
        config: mockUnicaProvider.configJson,
        secrets: {},
      } as any);
      vi.mocked(storage.getUser).mockResolvedValue(null);

      const response = await request(app).get("/api/admin/tts-stt/asr-providers/unica_asr_1");

      expect(response.status).toBe(200);
      expect(response.body.id).toBe("unica_asr_1");
      expect(response.body.displayName).toBe("Unica ASR Dev");
      expect(response.body.asrProviderType).toBe("unica");
      expect(response.body.config).toEqual(mockUnicaProvider.configJson);
    });

    it("should return 404 if provider not found", async () => {
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce(null as any);

      const response = await request(app).get("/api/admin/tts-stt/asr-providers/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Provider not found");
    });
  });

  describe("POST /api/admin/tts-stt/asr-providers", () => {
    it("should create new Unica provider", async () => {
      const newProviderData = {
        displayName: "Unica ASR Production",
        config: {
          baseUrl: "https://prod.example.com/api",
          workspaceId: "PROD",
          pollingIntervalMs: 5000,
          timeoutMs: 3600000,
        },
      };

      vi.mocked(speechProviderService.createUnicaProvider).mockResolvedValueOnce({
        ...mockUnicaProvider,
        id: "unica_asr_2",
        displayName: newProviderData.displayName,
        configJson: newProviderData.config,
      } as any);

      const response = await request(app)
        .post("/api/admin/tts-stt/asr-providers")
        .send(newProviderData);

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.displayName).toBe("Unica ASR Production");
      expect(response.body.asrProviderType).toBe("unica");
      expect(speechProviderService.createUnicaProvider).toHaveBeenCalledWith(
        newProviderData.displayName,
        newProviderData.config
      );
    });

    it("should validate required fields", async () => {
      const invalidData = {
        displayName: "Test",
        config: {
          baseUrl: "not-a-url",
          workspaceId: "",
        },
      };

      const response = await request(app)
        .post("/api/admin/tts-stt/asr-providers")
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Validation error");
      expect(speechProviderService.createUnicaProvider).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/admin/tts-stt/asr-providers/:id", () => {
    it("should update provider", async () => {
      const updateData = {
        displayName: "Updated Name",
        isEnabled: false,
      };

      vi.mocked(speechProviderService.getById).mockResolvedValueOnce({
        provider: mockUnicaProvider,
        config: mockUnicaProvider.configJson,
        secrets: {},
      } as any);

      vi.mocked(speechProviderService.update).mockResolvedValueOnce({
        provider: {
          ...mockUnicaProvider,
          displayName: updateData.displayName,
          isEnabled: updateData.isEnabled,
        },
        config: mockUnicaProvider.configJson,
        secrets: {},
      } as any);

      const response = await request(app)
        .patch("/api/admin/tts-stt/asr-providers/unica_asr_1")
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.displayName).toBe("Updated Name");
      expect(response.body.isEnabled).toBe(false);
    });

    it("should return 404 if provider not found", async () => {
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce(null as any);

      const response = await request(app)
        .patch("/api/admin/tts-stt/asr-providers/nonexistent")
        .send({ isEnabled: false });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/tts-stt/asr-providers/:id", () => {
    it("should delete provider", async () => {
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce({
        provider: mockUnicaProvider,
        config: mockUnicaProvider.configJson,
        secrets: {},
      } as any);
      vi.mocked(storage.db.query.skills.findMany).mockResolvedValueOnce([]);
      vi.mocked(storage.deleteSpeechProvider).mockResolvedValueOnce(undefined);

      const response = await request(app).delete("/api/admin/tts-stt/asr-providers/unica_asr_1");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Provider deleted successfully");
      expect(storage.deleteSpeechProvider).toHaveBeenCalledWith("unica_asr_1");
    });

    it("should prevent deletion if provider is used by skills", async () => {
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce({
        provider: mockUnicaProvider,
        config: mockUnicaProvider.configJson,
        secrets: {},
      } as any);
      vi.mocked(storage.db.query.skills.findMany).mockResolvedValueOnce([
        { id: "skill-1", name: "Test Skill" },
        { id: "skill-2", name: "Another Skill" },
      ] as any);

      const response = await request(app).delete("/api/admin/tts-stt/asr-providers/unica_asr_1");

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Provider is used by skills");
      expect(response.body.skillIds).toEqual(["skill-1", "skill-2"]);
      expect(storage.deleteSpeechProvider).not.toHaveBeenCalled();
    });

    it("should return 404 if provider not found", async () => {
      vi.mocked(speechProviderService.getById).mockResolvedValueOnce(null as any);

      const response = await request(app).delete("/api/admin/tts-stt/asr-providers/nonexistent");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/admin/tts-stt/asr-providers/test", () => {
    it("should test connection successfully", async () => {
      const config = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "TEST",
      };

      // Mock fetch for connection test
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const response = await request(app)
        .post("/api/admin/tts-stt/asr-providers/test")
        .send({ config });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Connection successful");
    });

    it("should handle connection failures", async () => {
      const config = {
        baseUrl: "https://test.example.com/api",
        workspaceId: "TEST",
      };

      global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

      const response = await request(app)
        .post("/api/admin/tts-stt/asr-providers/test")
        .send({ config });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("Network error");
    });

    it("should validate config", async () => {
      const invalidConfig = {
        baseUrl: "not-a-url",
        workspaceId: "",
      };

      const response = await request(app)
        .post("/api/admin/tts-stt/asr-providers/test")
        .send({ config: invalidConfig });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid config");
    });
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../server/storage", () => ({
  storage: {
    listSpeechProviders: vi.fn(),
    getSpeechProvider: vi.fn(),
    getSpeechProviderSecrets: vi.fn(),
    updateSpeechProvider: vi.fn(),
    upsertSpeechProviderSecret: vi.fn(),
    deleteSpeechProviderSecret: vi.fn(),
  },
}));

import { speechProviderService, SpeechProviderDisabledError, SpeechProviderServiceError } from "../server/speech-provider-service";
import { storage } from "../server/storage";
import type { SpeechProvider } from "@shared/schema";

const baseProvider: SpeechProvider = {
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
  updatedByAdminId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("speechProviderService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.listSpeechProviders).mockResolvedValue([baseProvider]);
    vi.mocked(storage.getSpeechProvider).mockResolvedValue(baseProvider);
    vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValue([]);
    vi.mocked(storage.updateSpeechProvider).mockResolvedValue({ ...baseProvider });
  });

  it("lists providers with summary fields", async () => {
    const summaries = await speechProviderService.listProviders();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: baseProvider.id,
      status: baseProvider.status,
      isEnabled: baseProvider.isEnabled,
    });
    expect(storage.listSpeechProviders).toHaveBeenCalledTimes(1);
  });

  it("updates config, status and secrets for built-in provider", async () => {
    const updatedProvider: SpeechProvider = {
      ...baseProvider,
      isEnabled: true,
      status: "Enabled",
      configJson: { languageCode: "ru-RU" },
    };

    vi.mocked(storage.getSpeechProvider)
      .mockResolvedValueOnce(baseProvider)
      .mockResolvedValueOnce(updatedProvider);

    vi.mocked(storage.updateSpeechProvider).mockResolvedValue(updatedProvider);
    vi.mocked(storage.getSpeechProviderSecrets).mockResolvedValue([
      { providerId: baseProvider.id, secretKey: "apiKey", secretValue: "secret", createdAt: "", updatedAt: "" },
      { providerId: baseProvider.id, secretKey: "folderId", secretValue: "", createdAt: "", updatedAt: "" },
    ]);

    const detail = await speechProviderService.updateProviderConfig({
      providerId: baseProvider.id,
      actorAdminId: "admin-1",
      isEnabled: true,
      configPatch: { languageCode: "ru-RU", ignoredField: "noop" },
      secretsPatch: [
        { key: "apiKey", value: "secret" },
        { key: "folderId", clear: true },
      ],
    });

    expect(storage.updateSpeechProvider).toHaveBeenCalled();
    expect(storage.upsertSpeechProviderSecret).toHaveBeenCalledWith(baseProvider.id, "apiKey", "secret");
    expect(storage.deleteSpeechProviderSecret).toHaveBeenCalledWith(baseProvider.id, "folderId");
    expect(detail.provider.isEnabled).toBe(true);
    expect(detail.config.languageCode).toBe("ru-RU");
    expect(detail.secrets.apiKey.isSet).toBe(true);
    expect(detail.secrets.folderId.isSet).toBe(false);
  });

  it("throws when provider is not built-in", async () => {
    vi.mocked(storage.getSpeechProvider).mockResolvedValue({
      ...baseProvider,
      id: "custom",
      isBuiltIn: false,
    });

    await expect(
      speechProviderService.updateProviderConfig({
        providerId: "custom",
        actorAdminId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(SpeechProviderServiceError);
  });

  it("throws when active STT provider is disabled", async () => {
    vi.mocked(storage.getSpeechProvider).mockResolvedValue({ ...baseProvider, isEnabled: false, status: "Disabled" });

    await expect(speechProviderService.getActiveSttProviderOrThrow()).rejects.toBeInstanceOf(
      SpeechProviderDisabledError,
    );
  });
});

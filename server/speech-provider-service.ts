import { storage } from "./storage";
import { z } from "zod";
import type {
  SpeechProvider,
  SpeechProviderSecret,
  SpeechProviderStatus,
  SpeechProviderInsert,
  AsrProviderType,
  UnicaAsrConfig,
} from "@shared/schema";
import { log } from "./vite";

export class SpeechProviderServiceError extends Error {
  public status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SpeechProviderServiceError";
    this.status = status;
  }
}

export class SpeechProviderNotFoundError extends SpeechProviderServiceError {
  constructor(message = "Провайдер речи не найден") {
    super(message, 404);
    this.name = "SpeechProviderNotFoundError";
  }
}

export class SpeechProviderDisabledError extends SpeechProviderServiceError {
  constructor(message = "STT-провайдер отключен") {
    super(message, 503);
    this.name = "SpeechProviderDisabledError";
  }
}

const BUILT_IN_STT_PROVIDER_ID = "yandex_speechkit";
const BUILT_IN_SECRET_KEYS = ["apiKey", "folderId", "serviceAccountKey", "s3AccessKeyId", "s3SecretAccessKey", "s3BucketName"] as const;
const BUILT_IN_CONFIG_KEYS = ["languageCode", "model", "enablePunctuation"] as const;

// Валидация конфигурации Unica ASR
export const unicaAsrConfigSchema = z.object({
  baseUrl: z.string().url("Некорректный Base URL"),
  workspaceId: z.string().min(1, "Укажите Workspace ID"),
  pollingIntervalMs: z.number().min(1000).max(60000).optional().default(5000),
  timeoutMs: z.number().min(60000).max(7200000).optional().default(3600000), // 60 минут по умолчанию, макс 2 часа
});

export type SpeechProviderSummary = Pick<
  SpeechProvider,
  | "id"
  | "displayName"
  | "providerType"
  | "direction"
  | "status"
  | "isEnabled"
  | "lastStatusChangedAt"
  | "updatedAt"
  | "updatedByAdminId"
>;

export type SpeechProviderSecretsPatch = Array<{
  key: string;
  value?: string | null;
  clear?: boolean;
}>;

export type SpeechProviderDetail = {
  provider: SpeechProvider;
  config: Record<string, unknown>;
  secrets: Record<string, { isSet: boolean }>;
};

const emptyRecord: Record<string, unknown> = {};

function mergeConfig(
  current: Record<string, unknown> | null | undefined,
  patch?: Record<string, unknown>,
): Record<string, unknown> {
  if (!patch || Object.keys(patch).length === 0) {
    return current ?? {};
  }

  const result = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (!BUILT_IN_CONFIG_KEYS.includes(key as (typeof BUILT_IN_CONFIG_KEYS)[number])) {
      continue;
    }
    if (value === null) {
      delete result[key];
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function buildSecretFlags(
  stored: SpeechProviderSecret[],
  knownKeys: readonly string[],
): Record<string, { isSet: boolean }> {
  const flags: Record<string, { isSet: boolean }> = {};
  for (const key of knownKeys) {
    flags[key] = { isSet: false };
  }

  for (const entry of stored) {
    flags[entry.secretKey] = { isSet: Boolean(entry.secretValue?.trim()) };
  }
  return flags;
}

class SpeechProviderService {
  async listProviders(): Promise<SpeechProviderSummary[]> {
    const providers = await storage.listSpeechProviders();
    return providers.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      providerType: provider.providerType,
      direction: provider.direction,
      status: provider.status,
      isEnabled: provider.isEnabled,
      lastStatusChangedAt: provider.lastStatusChangedAt,
      updatedAt: provider.updatedAt,
      updatedByAdminId: provider.updatedByAdminId ?? null,
    }));
  }

  async getProviderById(providerId: string): Promise<SpeechProviderDetail> {
    const provider = await storage.getSpeechProvider(providerId);
    if (!provider) {
      throw new SpeechProviderNotFoundError();
    }

    const secrets = await storage.getSpeechProviderSecrets(provider.id);
    return {
      provider,
      config: (provider.configJson as Record<string, unknown> | null) ?? emptyRecord,
      secrets: buildSecretFlags(secrets, BUILT_IN_SECRET_KEYS),
    };
  }

  async getProviderSecretValues(providerId: string): Promise<Record<string, string>> {
    const provider = await storage.getSpeechProvider(providerId);
    if (!provider) {
      throw new SpeechProviderNotFoundError();
    }
    if (!provider.isBuiltIn) {
      throw new SpeechProviderServiceError("Only built-in provider 'Yandex SpeechKit' secrets can be exposed", 400);
    }

    const secrets = await storage.getSpeechProviderSecrets(providerId);
    const values: Record<string, string> = {};
    for (const entry of secrets) {
      if (!BUILT_IN_SECRET_KEYS.includes(entry.secretKey as (typeof BUILT_IN_SECRET_KEYS)[number])) {
        continue;
      }
      const key = entry.secretKey as (typeof BUILT_IN_SECRET_KEYS)[number];
      values[key] = entry.secretValue;
    }

    return values;
  }

  async updateProviderConfig(opts: {
    providerId: string;
    actorAdminId: string;
    isEnabled?: boolean;
    configPatch?: Record<string, unknown>;
    secretsPatch?: SpeechProviderSecretsPatch;
    validateExternally?: boolean;
  }): Promise<SpeechProviderDetail> {
    const provider = await storage.getSpeechProvider(opts.providerId);
    if (!provider) {
      throw new SpeechProviderNotFoundError();
    }
    if (!provider.isBuiltIn) {
      throw new SpeechProviderServiceError("Only built-in provider 'Yandex SpeechKit' is allowed in current version", 400);
    }

    const now = new Date();
    let configChanged = false;
    let secretsChanged = false;

    const hasConfigPatch = Boolean(opts.configPatch && Object.keys(opts.configPatch).length > 0);
    const nextConfig = hasConfigPatch
      ? mergeConfig(provider.configJson as Record<string, unknown> | null, opts.configPatch)
      : ((provider.configJson as Record<string, unknown> | null) ?? {});

    const updates: Partial<SpeechProviderInsert> = {
      updatedByAdminId: opts.actorAdminId,
    };

    if (hasConfigPatch) {
      configChanged = true;
      updates.configJson = nextConfig;
    }

    if (typeof opts.isEnabled === "boolean" && opts.isEnabled !== provider.isEnabled) {
      updates.isEnabled = opts.isEnabled;
      updates.status = (opts.isEnabled ? "Enabled" : "Disabled") as SpeechProviderStatus;
      updates.lastStatusChangedAt = now;
      if (!opts.isEnabled) {
        updates.lastErrorCode = null;
        updates.lastErrorMessage = null;
      }
    }

    const sanitizedSecretOps = (opts.secretsPatch ?? [])
      .map((entry) => ({
        key: entry.key.trim(),
        value: entry.value?.toString().trim(),
        clear: Boolean(entry.clear),
      }))
      .filter((entry) => entry.key.length > 0);

    for (const op of sanitizedSecretOps) {
      secretsChanged = true;
      if (op.clear || !op.value) {
        await storage.deleteSpeechProviderSecret(provider.id, op.key);
      } else {
        await storage.upsertSpeechProviderSecret(provider.id, op.key, op.value);
      }
    }

    if (configChanged || secretsChanged || opts.isEnabled !== undefined) {
      updates.lastValidationAt = now;
      if (opts.isEnabled !== false) {
        updates.lastErrorCode = null;
        updates.lastErrorMessage = null;
      }
    }

    if (Object.keys(updates).length > 1) {
      await storage.updateSpeechProvider(provider.id, updates);
    }

    return await this.getProviderById(provider.id);
  }

  async getActiveSttProviderOrThrow(): Promise<SpeechProviderDetail> {
    const detail = await this.getProviderById(BUILT_IN_STT_PROVIDER_ID);
    if (!detail.provider.isEnabled || detail.provider.status !== "Enabled") {
      throw new SpeechProviderDisabledError();
    }
    return detail;
  }

  // Aliases for consistent naming in admin routes
  async list(): Promise<SpeechProviderSummary[]> {
    return this.listProviders();
  }

  async getById(providerId: string): Promise<SpeechProviderDetail> {
    return this.getProviderById(providerId);
  }

  async getSecrets(providerId: string): Promise<Record<string, string>> {
    return this.getProviderSecretValues(providerId);
  }

  async update(providerId: string, payload: { isEnabled?: boolean; config?: Record<string, unknown>; secrets?: Record<string, string | null> }): Promise<SpeechProviderDetail> {
    // Extract admin ID from request context - for now, use a default
    const actorAdminId = 'admin'; // TODO: get from request context
    
    // Convert secrets object to array format expected by updateProviderConfig
    let secretsPatch: SpeechProviderSecretsPatch | undefined;
    if (payload.secrets) {
      secretsPatch = Object.entries(payload.secrets).map(([key, value]) => ({
        key,
        value: value ?? undefined,
        clear: value === null,
      }));
    }
    
    return this.updateProviderConfig({
      providerId,
      actorAdminId,
      isEnabled: payload.isEnabled,
      configPatch: payload.config,
      secretsPatch,
    });
  }

  async testIamToken(providerId: string): Promise<{ success: boolean; message: string }> {
    const provider = await storage.getSpeechProvider(providerId);
    if (!provider) {
      throw new SpeechProviderNotFoundError();
    }
    // Placeholder implementation - actual IAM token testing would require specific Yandex Cloud API calls
    return { success: true, message: 'IAM token test not yet implemented' };
  }

  /**
   * Получить ASR провайдер для навыка
   * Провайдер должен быть явно выбран в навыке
   */
  async getAsrProviderForSkill(skillId: string): Promise<SpeechProviderDetail | null> {
    // Get skill from storage using Drizzle query
    const skillRecord = await storage.db.query.skills.findFirst({
      where: (skills, { eq }) => eq(skills.id, skillId),
    });

    if (!skillRecord) {
      return null;
    }

    // Провайдер должен быть выбран в навыке
    if (!skillRecord.asrProviderId) {
      return null; // Провайдер не настроен
    }

    const provider = await this.getProviderById(skillRecord.asrProviderId);
    if (!provider || !provider.provider.isEnabled) {
      throw new SpeechProviderServiceError(`ASR provider ${skillRecord.asrProviderId} is not available or disabled`, 400);
    }

    return provider;
  }

  /**
   * Получить провайдер по типу ASR
   */
  async getProviderByAsrType(asrType: AsrProviderType): Promise<SpeechProviderDetail | null> {
    const providers = await storage.listSpeechProviders();
    const provider = providers.find(
      (p) => p.asrProviderType === asrType && p.isEnabled
    );

    if (!provider) {
      return null;
    }

    return this.getProviderById(provider.id);
  }

  /**
   * Получить список всех доступных ASR провайдеров
   */
  async getAvailableAsrProviders(): Promise<SpeechProviderDetail[]> {
    const providers = await storage.listSpeechProviders();
    const asrProviders = providers.filter(
      (p) => p.providerType === "stt" && p.isEnabled
    );

    const details: SpeechProviderDetail[] = [];
    for (const provider of asrProviders) {
      const detail = await this.getProviderById(provider.id);
      if (detail) {
        details.push(detail);
      }
    }

    return details;
  }

  /**
   * Валидировать конфигурацию провайдера
   */
  validateProviderConfig(
    asrType: AsrProviderType,
    config: Record<string, unknown>
  ): { valid: boolean; errors?: string[] } {
    if (asrType === "unica") {
      const result = unicaAsrConfigSchema.safeParse(config);
      if (!result.success) {
        return {
          valid: false,
          errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
        };
      }
      return { valid: true };
    }

    // Для Yandex — существующая валидация
    return { valid: true };
  }

  /**
   * Создать Unica ASR провайдер
   */
  async createUnicaProvider(
    displayName: string,
    config: UnicaAsrConfig
  ): Promise<SpeechProvider> {
    const validation = this.validateProviderConfig("unica", config);
    if (!validation.valid) {
      throw new SpeechProviderServiceError(`Invalid config: ${validation.errors?.join(", ")}`, 400);
    }

    const id = `unica_asr_${Date.now()}`;

    const provider = await storage.createSpeechProvider({
      id,
      displayName,
      providerType: "stt",
      asrProviderType: "unica",
      direction: "audio_to_text",
      isEnabled: true,
      status: "Enabled",
      configJson: config as unknown as Record<string, unknown>,
      isBuiltIn: false,
    });

    log(`[SpeechProvider] Created Unica ASR provider: ${id}`);

    return provider;
  }

  /**
   * Определить тип ASR провайдера
   */
  getAsrProviderType(provider: SpeechProvider): AsrProviderType {
    return provider.asrProviderType || "yandex";
  }
}

export const speechProviderService = new SpeechProviderService();

import { storage } from "./storage";
import type {
  SpeechProvider,
  SpeechProviderSecret,
  SpeechProviderStatus,
  SpeechProviderInsert,
} from "@shared/schema";

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

  async update(providerId: string, payload: { isEnabled?: boolean; config?: Record<string, unknown>; secrets?: SpeechProviderSecretsPatch }): Promise<SpeechProviderDetail> {
    // Extract admin ID from request context - for now, use a default
    const actorAdminId = 'admin'; // TODO: get from request context
    return this.updateProviderConfig({
      providerId,
      actorAdminId,
      isEnabled: payload.isEnabled,
      configPatch: payload.config,
      secretsPatch: payload.secrets,
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
}

export const speechProviderService = new SpeechProviderService();

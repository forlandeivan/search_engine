import { storage } from "./storage";
import { listModels } from "./model-service";
import type { EmbeddingProvider } from "@shared/schema";

export type EmbeddingProviderStatus = {
  id: string;
  displayName: string;
  providerType: EmbeddingProvider["providerType"];
  model: string;
  isActive: boolean;
  isConfigured: boolean;
  statusReason?: string;
};

export type EmbeddingProviderModelsInfo = {
  providerId: string;
  providerName: string;
  supportsModelSelection: boolean;
  defaultModel: string | null;
  models: string[];
  isConfigured: boolean;
  statusReason?: string;
};

function computeStatus(provider: EmbeddingProvider): Pick<EmbeddingProviderStatus, "isConfigured" | "statusReason"> {
  if (!provider.isActive) {
    return { isConfigured: false, statusReason: "Провайдер отключен" };
  }

  const hasAuthKey = typeof provider.authorizationKey === "string" && provider.authorizationKey.trim().length > 0;
  if (!hasAuthKey) {
    return { isConfigured: false, statusReason: "Не задан ключ авторизации" };
  }

  const embeddingsUrl = typeof provider.embeddingsUrl === "string" ? provider.embeddingsUrl.trim() : "";
  if (!embeddingsUrl) {
    return { isConfigured: false, statusReason: "Не указан URL сервиса эмбеддингов" };
  }

  const tokenUrl = typeof provider.tokenUrl === "string" ? provider.tokenUrl.trim() : "";
  if (!tokenUrl) {
    return { isConfigured: false, statusReason: "Не указан URL получения токена" };
  }

  const model = typeof provider.model === "string" ? provider.model.trim() : "";
  if (!model) {
    return { isConfigured: false, statusReason: "Не указана модель" };
  }

  return { isConfigured: true };
}

export async function listEmbeddingProvidersWithStatus(workspaceId?: string): Promise<EmbeddingProviderStatus[]> {
  const providers = await storage.listEmbeddingProviders(workspaceId);

  return providers.map((provider) => {
    const { isConfigured, statusReason } = computeStatus(provider);
    return {
      id: provider.id,
      displayName: provider.name,
      providerType: provider.providerType,
      model: provider.model,
      isActive: provider.isActive,
      isConfigured,
      statusReason,
    };
  });
}

function normalizeModelList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export async function resolveEmbeddingProviderModels(
  providerId: string,
  workspaceId?: string,
): Promise<EmbeddingProviderModelsInfo | null> {
  const provider = await storage.getEmbeddingProvider(providerId, workspaceId);
  if (!provider) {
    return null;
  }

  const status = computeStatus(provider);
  const catalogModels = await listModels({
    includeInactive: false,
    type: "EMBEDDINGS",
    providerId: provider.id,
    providerType: provider.providerType?.toUpperCase() ?? provider.providerType,
  });

  const models = Array.from(
    new Set(
      catalogModels
        .map((model) => (model.providerModelKey || model.modelKey || "").trim())
        .filter((key) => key.length > 0),
    ),
  );

  const defaultModel =
    (typeof provider.model === "string" && provider.model.trim().length > 0 ? provider.model.trim() : null) ||
    models[0] ||
    null;
  const supportsModelSelection = models.length > 0;

  return {
    providerId: provider.id,
    providerName: provider.name,
    supportsModelSelection,
    defaultModel,
    models,
    isConfigured: status.isConfigured,
    statusReason: status.statusReason,
  };
}

export async function resolveEmbeddingProviderStatus(
  providerId: string,
  workspaceId?: string,
): Promise<EmbeddingProviderStatus | null> {
  const provider = await storage.getEmbeddingProvider(providerId, workspaceId);
  if (!provider) {
    return null;
  }

  const { isConfigured, statusReason } = computeStatus(provider);

  return {
    id: provider.id,
    displayName: provider.name,
    providerType: provider.providerType,
    model: provider.model,
    isActive: provider.isActive,
    isConfigured,
    statusReason,
  };
}

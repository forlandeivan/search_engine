import { storage } from "./storage";
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

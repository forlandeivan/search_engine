import type { QdrantClient } from "@qdrant/js-client-rest";
import type { EmbeddingProvider } from "@shared/schema";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";

function parseVectorSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function resolveVectorSizeForCollection(
  provider: EmbeddingProvider,
  detectedVectorLength: number,
): number {
  const configuredSize = parseVectorSize(provider.qdrantConfig?.vectorSize);
  if (configuredSize) {
    return configuredSize;
  }

  if (detectedVectorLength > 0) {
    return detectedVectorLength;
  }

  if (provider.providerType === "gigachat") {
    return GIGACHAT_EMBEDDING_VECTOR_SIZE;
  }

  throw new Error(
    "Не удалось определить размер вектора для новой коллекции. Укажите vectorSize в настройках сервиса эмбеддингов",
  );
}

export async function ensureCollectionCreatedIfNeeded(options: {
  client: QdrantClient;
  provider: EmbeddingProvider;
  collectionName: string;
  detectedVectorLength: number;
  shouldCreateCollection: boolean;
  collectionExists: boolean;
}): Promise<boolean> {
  const {
    client,
    provider,
    collectionName,
    detectedVectorLength,
    shouldCreateCollection,
    collectionExists,
  } = options;

  if (collectionExists || !shouldCreateCollection) {
    return false;
  }

  const vectorSizeForCreation = resolveVectorSizeForCollection(
    provider,
    detectedVectorLength,
  );

  await client.createCollection(collectionName, {
    vectors: {
      size: vectorSizeForCreation,
      distance: "Cosine",
    },
  });

  return true;
}


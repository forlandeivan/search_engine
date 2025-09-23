import { QdrantClient, type QdrantClientParams } from "@qdrant/js-client-rest";

export class QdrantConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QdrantConfigurationError";
  }
}

let qdrantClient: QdrantClient | null = null;

export function getQdrantClient(customParams: QdrantClientParams = {}): QdrantClient {
  if (qdrantClient) {
    return qdrantClient;
  }

  const url = process.env.QDRANT_URL;
  if (!url) {
    throw new QdrantConfigurationError("Переменная окружения QDRANT_URL не задана");
  }

  const apiKey = process.env.QDRANT_API_KEY;

  qdrantClient = new QdrantClient({
    url,
    apiKey: apiKey || undefined,
    ...customParams,
  });

  return qdrantClient;
}

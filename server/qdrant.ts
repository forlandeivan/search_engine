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

  const parsedUrl = new URL(url);
  let defaultPort: number | undefined;

  if (!parsedUrl.port) {
    if (parsedUrl.protocol === "https:") {
      defaultPort = 443;
    } else if (parsedUrl.protocol === "http:") {
      defaultPort = 80;
    }
  }

  qdrantClient = new QdrantClient({
    url,
    apiKey: apiKey || undefined,
    ...(defaultPort !== undefined ? { port: defaultPort } : {}),
    ...customParams,
  });

  return qdrantClient;
}

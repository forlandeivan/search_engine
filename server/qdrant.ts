import { QdrantClient, type QdrantClientParams } from "@qdrant/js-client-rest";

/**
 * Error thrown when Qdrant is not configured
 */
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

/**
 * Extract structured error information from Qdrant API errors
 */
export function extractQdrantApiError(error: unknown):
  | {
      status: number;
      message: string;
      details: unknown;
    }
  | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    status?: unknown;
    statusText?: unknown;
    data?: unknown;
    message?: unknown;
  };

  if (typeof candidate.status !== "number") {
    return undefined;
  }

  if (typeof candidate.statusText !== "string" && typeof candidate.message !== "string") {
    return undefined;
  }

  const data = candidate.data;
  let message: string | undefined;

  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    const nestedError = dataRecord.error;
    const nestedStatus = dataRecord.status;
    const nestedMessage = dataRecord.message;

    if (typeof nestedError === "string" && nestedError.trim().length > 0) {
      message = nestedError;
    } else if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
      message = nestedMessage;
    } else if (typeof nestedStatus === "string" && nestedStatus.trim().length > 0) {
      message = nestedStatus;
    }
  }

  if (!message) {
    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      message = candidate.message;
    } else if (
      typeof candidate.statusText === "string" &&
      candidate.statusText.trim().length > 0
    ) {
      message = candidate.statusText;
    } else {
      message = "Ошибка Qdrant";
    }
  }

  return {
    status: candidate.status,
    message,
    details: data ?? null,
  };
}

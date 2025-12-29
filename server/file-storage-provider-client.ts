import fetch, { type Response } from "node-fetch";
import FormData from "form-data";
import { randomUUID } from "crypto";

export type ProviderAuthType = "none" | "bearer";

export type ProviderClientOptions = {
  baseUrl: string;
  authType: ProviderAuthType;
  uploadPath?: string;
  defaultTimeoutMs?: number;
};

export type FileUploadContext = {
  workspaceId: string;
  skillId?: string | null;
  chatId?: string | null;
  userId?: string | null;
  messageId?: string | null;
};

export type FileUploadInput = FileUploadContext & {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  data: Buffer | NodeJS.ReadableStream;
  bearerToken?: string | null;
  abortSignal?: AbortSignal;
  objectKeyHint?: string;
};

export type FileUploadResult = {
  providerFileId: string;
  downloadUrl?: string | null;
  rawResponse?: unknown;
};

export class ProviderUploadError extends Error {
  constructor(
    message: string,
    public status: number = 500,
    public code: string = "UPLOAD_FAILED",
    public retryable: boolean = false,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ProviderUploadError";
  }
}

function buildTimeoutSignal(timeoutMs: number, external?: AbortSignal): AbortSignal | undefined {
  if (timeoutMs <= 0 && !external) return undefined;
  const controller = new AbortController();
  if (external) {
    external.addEventListener("abort", () => controller.abort(external.reason), { once: true });
  }
  if (timeoutMs > 0) {
    const timer = setTimeout(() => controller.abort("REQUEST_TIMEOUT"), timeoutMs);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
      },
      { once: true },
    );
  }
  return controller.signal;
}

function extractProviderFileId(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.provider_file_id === "string") return payload.provider_file_id;
  if (typeof payload.providerFileId === "string") return payload.providerFileId;
  if (typeof payload.fileId === "string") return payload.fileId;
  return null;
}

async function parseJsonSafe(res: Response): Promise<any | null> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export class FileStorageProviderClient {
  private readonly baseUrl: string;
  private readonly authType: ProviderAuthType;
  private readonly uploadPath: string;
  private readonly defaultTimeoutMs: number;

  // Future extension point: signed download link
  async getDownloadLink(
    _providerFileId: string,
    _options?: { expiresInSeconds?: number; bearerToken?: string | null },
  ): Promise<{ url: string; expiresAt?: string | null }> {
    throw new ProviderUploadError("Download link is not implemented in this provider client", 501, "NOT_IMPLEMENTED");
  }

  // Future extension point: download stream
  async openDownloadStream(
    _providerFileId: string,
    _options?: { bearerToken?: string | null },
  ): Promise<NodeJS.ReadableStream> {
    throw new ProviderUploadError("Download stream is not implemented in this provider client", 501, "NOT_IMPLEMENTED");
  }

  constructor(options: ProviderClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authType = options.authType;
    this.uploadPath = options.uploadPath ?? "/files/upload";
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
  }

  async uploadFile(input: FileUploadInput): Promise<FileUploadResult> {
    if (this.authType === "bearer" && !input.bearerToken) {
      throw new ProviderUploadError(
        "Bearer token is required for provider authentication",
        401,
        "AUTH_REQUIRED",
        false,
      );
    }

    const form = new FormData();
    form.append("file", input.data as any, {
      filename: input.fileName,
      contentType: input.mimeType ?? undefined,
      knownLength: typeof input.sizeBytes === "number" ? input.sizeBytes : undefined,
    });

    form.append(
      "metadata",
      JSON.stringify({
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        context: {
          workspaceId: input.workspaceId,
          skillId: input.skillId ?? null,
          chatId: input.chatId ?? null,
          userId: input.userId ?? null,
          messageId: input.messageId ?? null,
          objectKeyHint: input.objectKeyHint ?? null,
        },
      }),
    );

    const url = new URL(this.uploadPath, this.baseUrl).toString();
    const requestId = randomUUID();
    const timeoutSignal = buildTimeoutSignal(this.defaultTimeoutMs, input.abortSignal);

    const headers: Record<string, string> = {
      "x-request-id": requestId,
      ...form.getHeaders(),
    };
    if (this.authType === "bearer" && input.bearerToken) {
      headers.Authorization = `Bearer ${input.bearerToken}`;
    }

    const isRetryableStatus = (status: number) => [502, 503, 504].includes(status);
    const maxAttempts = 3;
    const baseDelayMs = 500;
    let attempt = 0;

    const attemptUpload = async (): Promise<Response> => {
      attempt += 1;
      try {
        return await fetch(url, {
          method: "POST",
          headers,
          body: form as any,
          signal: timeoutSignal,
        });
      } catch (error: any) {
        const isAbort = error?.name === "AbortError" || error?.message === "REQUEST_TIMEOUT";
        const code = isAbort ? "TIMEOUT" : "NETWORK_ERROR";
        const retryable = !isAbort;
        throw new ProviderUploadError(
          isAbort ? "Внешний провайдер не ответил вовремя" : "Не удалось отправить файл внешнему провайдеру",
          isAbort ? 504 : 502,
          code,
          retryable,
          { error: error?.message, requestId, url, attempt },
        );
      }
    };

    let res: Response;
    try {
      res = await attemptUpload();
    } catch (err) {
      // network/timeout on first attempt
      const error = err as ProviderUploadError;
      if (error.retryable && attempt < maxAttempts) {
        for (; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
          try {
            res = await attemptUpload();
            break;
          } catch (nextErr) {
            if (!(nextErr instanceof ProviderUploadError) || !nextErr.retryable || attempt + 1 >= maxAttempts) {
              throw nextErr;
            }
            // continue retry loop
          }
        }
      } else {
        throw error;
      }
    }

    const payload = await parseJsonSafe(res);
    if (!res.ok) {
      const message =
        (payload && (payload.error || payload.message)) ||
        `Провайдер вернул ошибку ${res.status}`;
      const retryable = isRetryableStatus(res.status);
      throw new ProviderUploadError(message, res.status, "PROVIDER_ERROR", retryable, {
        status: res.status,
        requestId,
        url,
        response: payload ?? null,
      });
    }

    const providerFileId = extractProviderFileId(payload);
    if (!providerFileId) {
      throw new ProviderUploadError("В ответе провайдера нет provider_file_id", 502, "MALFORMED_RESPONSE", {
        status: res.status,
        requestId,
        url,
        response: payload ?? null,
      });
    }

    return {
      providerFileId,
      downloadUrl: typeof payload?.download_url === "string" ? payload.download_url : payload?.downloadUrl ?? null,
      rawResponse: payload,
    };
  }
}

export function createFileStorageProviderClient(options: ProviderClientOptions): FileStorageProviderClient {
  return new FileStorageProviderClient(options);
}

import fetch, { type Response } from "node-fetch";
import FormData from "form-data";
import { randomUUID } from "crypto";
import { buildPathFromTemplate } from "./file-storage-path";

export type ProviderAuthType = "none" | "bearer";

export type ProviderClientOptions = {
  baseUrl: string;
  authType: ProviderAuthType;
  uploadPath?: string;
  defaultTimeoutMs?: number;
  config?: {
    uploadMethod?: "POST" | "PUT";
    pathTemplate?: string;
    multipartFieldName?: string;
    metadataFieldName?: string | null;
    responseFileIdPath?: string;
    defaultTimeoutMs?: number | null;
    bucket?: string | null;
  };
};

export type FileUploadContext = {
  workspaceId: string;
  workspaceName?: string | null;
  skillId?: string | null;
  skillName?: string | null;
  chatId?: string | null;
  userId?: string | null;
  messageId?: string | null;
  bucket?: string | null;
  fileNameOriginal?: string | null;
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

function extractProviderFileId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.provider_file_id === "string") return obj.provider_file_id;
  if (typeof obj.providerFileId === "string") return obj.providerFileId;
  if (typeof obj.fileUri === "string") return obj.fileUri;
  if (typeof obj.fileId === "string") return obj.fileId;
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
  private readonly uploadMethod: "POST" | "PUT";
  private readonly multipartFieldName: string;
  private readonly metadataFieldName: string | null;
  private readonly responseFileIdPath: string;
  private readonly bucket: string | null;

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
    const cfg = options.config ?? {};
    this.uploadMethod = cfg.uploadMethod ?? "POST";
    this.uploadPath = options.uploadPath ?? cfg.pathTemplate ?? "/{workspaceId}/{objectKey}";
    this.multipartFieldName = cfg.multipartFieldName ?? "file";
    this.metadataFieldName = cfg.metadataFieldName ?? "metadata";
    this.responseFileIdPath = cfg.responseFileIdPath ?? "fileUri";
    this.defaultTimeoutMs = cfg.defaultTimeoutMs ?? options.defaultTimeoutMs ?? 15_000;
    this.bucket = cfg.bucket ?? null;
  }

  private buildUrl(input: FileUploadInput): string {
    const objectKey = input.objectKeyHint ?? input.fileName ?? "file";
    const pathContext = {
      bucket: this.bucket ?? input.bucket ?? null,
      workspaceId: input.workspaceId ?? "",
      workspaceName: input.workspaceName ?? null,
      objectKey,
      skillId: input.skillId ?? "",
      skillName: input.skillName ?? null,
      chatId: input.chatId ?? "",
      userId: input.userId ?? "",
      messageId: input.messageId ?? "",
      fileName: input.fileNameOriginal ?? input.fileName ?? objectKey,
    };
    const resolvedPath = buildPathFromTemplate(this.uploadPath, pathContext);
    return new URL(resolvedPath.replace(/^\//, ""), this.baseUrl + "/").toString();
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
    // FormData.append accepts Buffer | ReadableStream which matches input.data type
    form.append(this.multipartFieldName, input.data, {
      filename: input.fileName,
      contentType: input.mimeType ?? undefined,
      knownLength: typeof input.sizeBytes === "number" ? input.sizeBytes : undefined,
    });

    if (this.metadataFieldName) {
      form.append(
        this.metadataFieldName,
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
    }

    const url = this.buildUrl(input);
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
          method: this.uploadMethod,
          headers,
          body: form as unknown as BodyInit,
          signal: timeoutSignal,
        });
      } catch (error: unknown) {
        const errorObj = error as { name?: string; message?: string };
        const isAbort = errorObj?.name === "AbortError" || errorObj?.message === "REQUEST_TIMEOUT";
        const code = isAbort ? "TIMEOUT" : "NETWORK_ERROR";
        const retryable = !isAbort;
        const message = isAbort
          ? "Провайдер файлового хранилища не ответил вовремя"
          : "Не удалось отправить файл провайдеру файлового хранилища";
        throw new ProviderUploadError(
          message,
          isAbort ? 504 : 502,
          code,
          retryable,
          { error: error?.message, requestId, url, providerBaseUrl: this.baseUrl, attempt },
        );
      }
    };

    let res: Response | null = null;
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

    if (!res) {
      throw new ProviderUploadError(
        "Провайдер файлового хранилища не вернул ответ",
        502,
        "NO_RESPONSE",
        true,
        { requestId, url, providerBaseUrl: this.baseUrl, attempt },
      );
    }

    const payload = await parseJsonSafe(res);
    if (!res.ok) {
      const retryable = isRetryableStatus(res.status);
      throw new ProviderUploadError(
        `Провайдер файлового хранилища вернул ошибку ${res.status}`,
        res.status,
        "PROVIDER_ERROR",
        retryable,
        {
          status: res.status,
          requestId,
          url,
          providerBaseUrl: this.baseUrl,
          response: payload ?? null,
        },
      );
    }

    const providerFileId =
      typeof this.responseFileIdPath === "string" && this.responseFileIdPath.trim().length > 0
        ? this.responseFileIdPath
            .split(".")
            .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload) ??
          extractProviderFileId(payload)
        : extractProviderFileId(payload);
    if (!providerFileId) {
      throw new ProviderUploadError(
        "В ответе провайдера нет provider_file_id",
        502,
        "MALFORMED_RESPONSE",
        false,
        {
          status: res.status,
          requestId,
          url,
          response: payload ?? null,
        },
      );
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

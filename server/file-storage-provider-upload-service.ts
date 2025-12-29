import type { File } from "@shared/schema";
import { storage } from "./storage";
import { createFileStorageProviderClient, ProviderUploadError, type FileUploadContext } from "./file-storage-provider-client";
import { fileStorageProviderService, FileStorageProviderServiceError } from "./file-storage-provider-service";

export class FileUploadToProviderError extends Error {
  constructor(message: string, public status: number = 500, public details?: unknown) {
    super(message);
    this.name = "FileUploadToProviderError";
  }
}

type UploadParams = {
  fileId: string;
  providerId: string;
  bearerToken?: string | null;
  data: Buffer | NodeJS.ReadableStream;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  context: FileUploadContext;
};

export async function uploadFileToProvider(params: UploadParams): Promise<File> {
  const file = await storage.getFile(params.fileId, params.context.workspaceId);
  if (!file) {
    throw new FileUploadToProviderError("File not found", 404);
  }

  // Idempotency: already uploaded and ready
  if (file.providerFileId && file.status === "ready") {
    return file;
  }

  const provider = await fileStorageProviderService
    .getProviderById(params.providerId)
    .catch((err: unknown) => {
      if (err instanceof FileStorageProviderServiceError) {
        throw new FileUploadToProviderError(err.message, err.status);
      }
      throw err;
    });

  const client = createFileStorageProviderClient({
    baseUrl: provider.baseUrl,
    authType: provider.authType as "none" | "bearer",
  });

  // Mark uploading
  await storage.updateFile(params.fileId, {
    providerId: params.providerId,
    status: "uploading",
  });

  try {
    const result = await client.uploadFile({
      workspaceId: params.context.workspaceId,
      skillId: params.context.skillId ?? null,
      chatId: params.context.chatId ?? null,
      userId: params.context.userId ?? null,
      messageId: params.context.messageId ?? null,
      fileName: params.fileName ?? file.name ?? "file",
      mimeType: params.mimeType ?? file.mimeType ?? null,
      sizeBytes: params.sizeBytes ?? Number(file.sizeBytes ?? 0),
      data: params.data,
      bearerToken: params.bearerToken ?? null,
    });

    const nextMetadata = {
      ...(file.metadata as Record<string, unknown>),
      providerUpload: {
        at: new Date().toISOString(),
        downloadUrl: result.downloadUrl ?? null,
      },
    };

    const updated = await storage.updateFile(params.fileId, {
      providerId: params.providerId,
      providerFileId: result.providerFileId,
      status: "ready",
      metadata: nextMetadata,
    });

    return updated || (await storage.getFile(params.fileId))!;
  } catch (error) {
    const retryable =
      error instanceof ProviderUploadError ? error.retryable : false;
    const message =
      error instanceof ProviderUploadError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    const nextMetadata = {
      ...(file.metadata as Record<string, unknown>),
      providerUploadError: {
        message,
        retryable,
        at: new Date().toISOString(),
      },
    };

    await storage.updateFile(params.fileId, {
      providerId: params.providerId,
      status: "failed",
      metadata: nextMetadata,
    });

    if (error instanceof ProviderUploadError) {
      throw error;
    }
    throw new FileUploadToProviderError("Не удалось загрузить файл во внешний провайдер", 502, {
      cause: message,
    });
  }
}

import type { File, NoCodeAuthType } from "@shared/schema";
import { storage } from "./storage";
import {
  createFileStorageProviderClient,
  ProviderUploadError,
  type FileUploadContext,
} from "./file-storage-provider-client";
import {
  fileStorageProviderService,
  FileStorageProviderServiceError,
  normalizeFileProviderConfig,
  defaultProviderConfig,
} from "./file-storage-provider-service";
import { decryptSecret } from "./secret-storage";
import { createLogger } from "./lib/logger";

const logger = createLogger("file-storage-provider-upload");

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
  objectKeyHint?: string | null;
  context: FileUploadContext;
  skillContext?: {
    executionMode?: string | null;
    noCodeEndpointUrl?: string | null;
    noCodeAuthType?: NoCodeAuthType | null;
    noCodeBearerToken?: string | null;
  };
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

  const providerConfig = normalizeFileProviderConfig(provider.config ?? defaultProviderConfig);
  const client = createFileStorageProviderClient({
    baseUrl: provider.baseUrl,
    authType: provider.authType as "none" | "bearer",
    config: providerConfig,
  });

  // Mark uploading
  await storage.updateFile(params.fileId, {
    providerId: params.providerId,
    status: "uploading",
  });

  logger.info(
    {
      fileId: params.fileId,
      providerId: params.providerId,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      fileName: params.fileName ?? file.name,
      sizeBytes: params.sizeBytes ?? Number(file.sizeBytes ?? 0),
    },
    "[FILE-UPLOAD] Starting upload to provider",
  );

  try {
    const bearerToken =
      decryptSecret(params.bearerToken ?? null) ?? decryptSecret(params.skillContext?.noCodeBearerToken ?? null);
    const result = await client.uploadFile({
      workspaceId: params.context.workspaceId,
      workspaceName: params.context.workspaceName ?? null,
      skillId: params.context.skillId ?? null,
      skillName: params.context.skillName ?? null,
      chatId: params.context.chatId ?? null,
      userId: params.context.userId ?? null,
      messageId: params.context.messageId ?? null,
      bucket: params.context.bucket ?? null,
      fileNameOriginal: params.context.fileNameOriginal ?? null,
      fileName: params.fileName ?? file.name ?? "file",
      mimeType: params.mimeType ?? file.mimeType ?? null,
      sizeBytes: params.sizeBytes ?? Number(file.sizeBytes ?? 0),
      data: params.data,
      bearerToken: bearerToken ?? null,
      objectKeyHint: params.objectKeyHint ?? undefined,
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
      logger.error(
        {
          fileId: params.fileId,
          providerId: params.providerId,
          providerName: provider.name,
          baseUrl: provider.baseUrl,
          status: error.status,
          code: error.code,
          message: error.message,
          details: error.details,
        },
        "[FILE-UPLOAD] Provider upload failed",
      );
      // Обертываем ProviderUploadError в FileUploadToProviderError с дополнительной информацией о провайдере
      const providerName = provider.name ?? null;
      const originalDetails = error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {};
      const enhancedDetails: Record<string, unknown> = {
        ...originalDetails,
        providerName,
        baseUrl: provider.baseUrl,
        code: error.code,
      };
      throw new FileUploadToProviderError(error.message, error.status, enhancedDetails);
    }
    const providerName = provider.name ?? null;
    const errorDetails: Record<string, unknown> = { cause: message };
    if (providerName) {
      errorDetails.providerName = providerName;
    }
    logger.error(
      {
        fileId: params.fileId,
        providerId: params.providerId,
        providerName: provider.name,
        cause: message,
      },
      "[FILE-UPLOAD] Unexpected error during upload",
    );
    throw new FileUploadToProviderError("Не удалось загрузить файл во внешний провайдер", 502, errorDetails);
  }
}

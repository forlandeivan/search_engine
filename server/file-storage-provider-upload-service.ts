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
import { enqueueFileEventForSkill } from "./no-code-file-events";
import { decryptSecret } from "./secret-storage";

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
    noCodeFileEventsUrl?: string | null;
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

  const providerConfig = normalizeFileProviderConfig((provider as any).config ?? defaultProviderConfig);
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

    if (updated) {
      await enqueueFileEventForSkill({
        file: updated,
        action: "file_uploaded",
        skill: {
          executionMode: params.skillContext?.executionMode ?? null,
          noCodeFileEventsUrl: params.skillContext?.noCodeFileEventsUrl ?? null,
          noCodeAuthType: params.skillContext?.noCodeAuthType ?? null,
          noCodeBearerToken: bearerToken ?? null,
        },
      });
    }

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

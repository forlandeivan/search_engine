import {
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";
import { downloadMinioClient, minioClient } from "./minio-client";
import { storage } from "./storage";
import { adjustWorkspaceStorageUsageBytes } from "./usage/usage-service";
import { createLogger } from "./lib/logger";

const BUCKET_PREFIX = (process.env.WORKSPACE_BUCKET_PREFIX || "ws-").trim();
const logger = createLogger('workspace-storage');

/**
 * Формирует имя бакета для рабочего пространства.
 * Используются только строчные буквы, цифры и дефисы.
 * Пример: ws-<uuid-в-lower-case>.
 */
export function getWorkspaceBucketName(workspaceId: string): string {
  const normalized = workspaceId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${BUCKET_PREFIX}${normalized}`;
}

async function createBucketIfNeeded(bucketName: string): Promise<void> {
  try {
    await minioClient.send(new HeadBucketCommand({ Bucket: bucketName }));
    return;
  } catch (error) {
    // пробуем создать ниже
  }

  try {
    await minioClient.send(
      new CreateBucketCommand({
        Bucket: bucketName,
      }),
    );
  } catch (error: unknown) {
    const errorObj = error as { name?: string; Code?: string; code?: string };
    const code = errorObj?.name || errorObj?.Code || errorObj?.code;
    if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
      return;
    }
    console.error("[workspace-storage] create bucket failed", { bucketName, error });
    throw error;
  }
}

export async function ensureWorkspaceBucketExists(workspaceId: string): Promise<string> {
  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error("workspace not found");
  }

  if (workspace.storageBucket) {
    return workspace.storageBucket;
  }

  const bucketName = getWorkspaceBucketName(workspaceId);
  
  try {
    await createBucketIfNeeded(bucketName);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any)?.code || (error as any)?.name;
    
    // Проверяем на ошибки подключения к хранилищу
    if (
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ENOTFOUND' ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('connect') ||
      errorMessage.includes('connection')
    ) {
      logger.error('[workspace-storage] Storage connection error in ensureWorkspaceBucketExists', {
        originalError: errorMessage,
        errorCode,
        workspaceId,
        bucketName,
      });
      throw new Error('Не удалось подключиться к хранилищу файлов.');
    }
    
    throw error;
  }

  await storage.setWorkspaceStorageBucket(workspaceId, bucketName);

  return bucketName;
}

export async function putObject(
  workspaceId: string,
  key: string,
  body: Buffer | Readable,
  contentType?: string,
): Promise<void> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);

  try {
    await minioClient.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (error) {
    console.error("[workspace-storage] putObject failed", { bucket, key, error });
    throw error;
  }
}

export async function getObject(
  workspaceId: string,
  key: string,
): Promise<{ body: Readable; contentType?: string } | null> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);

  try {
    const response = await minioClient.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    if (!response.Body) return null;
    return {
      body: response.Body as Readable,
      contentType: response.ContentType || undefined,
    };
  } catch (error: unknown) {
    const errorObj = error as { name?: string; Code?: string; code?: string };
    const code = errorObj?.name || errorObj?.Code || errorObj?.code;
    if (code === "NoSuchKey" || code === "NotFound") {
      return null;
    }
    console.error("[workspace-storage] getObject failed", { bucket, key, error });
    throw error;
  }
}

export async function deleteObject(workspaceId: string, key: string): Promise<void> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);
  try {
    await minioClient.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  } catch (error: unknown) {
    const errorObj = error as { name?: string; Code?: string; code?: string };
    const code = errorObj?.name || errorObj?.Code || errorObj?.code;
    if (code === "NoSuchKey" || code === "NotFound") {
      console.warn("[workspace-storage] deleteObject: object missing (idempotent)", { bucket, key });
      return;
    }
    console.error("[workspace-storage] deleteObject failed", { bucket, key, error });
    throw error;
  }
}

const ALLOWED_PREFIXES = ["icons/", "files/", "attachments/", "chat-attachments/", "json-imports/"] as const;
type AllowedPrefix = (typeof ALLOWED_PREFIXES)[number];

function ensureAllowedPrefix(relativePath: string): void {
  if (!ALLOWED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    const message = `[workspace-storage] invalid path prefix. Use one of: ${ALLOWED_PREFIXES.join(", ")}`;
    console.warn(message, { relativePath });
    throw new Error("invalid path prefix");
  }
}

async function getWorkspaceObjectSize(workspaceId: string, relativePath: string): Promise<number | null> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);
  try {
    const response = await minioClient.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: relativePath,
      }),
    );
    return typeof response.ContentLength === "number" ? response.ContentLength : null;
  } catch (error: unknown) {
    const errorObj = error as { name?: string; Code?: string; code?: string };
    const code = errorObj?.name || errorObj?.Code || errorObj?.code;
    if (code === "NoSuchKey" || code === "NotFound") {
      return null;
    }
    console.error("[workspace-storage] headObject failed", { bucket, key: relativePath, error });
    throw error;
  }
}

/**
 * Единый интерфейс для загрузки файлов рабочего пространства.
 * Все новые фичи должны использовать этот слой, прямой доступ к minioClient запрещён.
 */
export async function uploadWorkspaceFile(
  workspaceId: string,
  relativePath: string,
  fileBuffer: Buffer | Readable,
  mimeType?: string,
  explicitSizeBytes?: number | null,
): Promise<{ key: string }> {
  ensureAllowedPrefix(relativePath);
  const previousSize = await getWorkspaceObjectSize(workspaceId, relativePath);
  const sizeBytes =
    explicitSizeBytes !== undefined && explicitSizeBytes !== null
      ? explicitSizeBytes
      : fileBuffer instanceof Buffer
        ? fileBuffer.length
        : null;

  await putObject(workspaceId, relativePath, fileBuffer, mimeType);

  if (sizeBytes !== null) {
    const delta = sizeBytes - (previousSize ?? 0);
    if (delta !== 0) {
      await adjustWorkspaceStorageUsageBytes(workspaceId, delta);
    }
  } else {
    console.warn("[storage-usage] uploadWorkspaceFile: size unknown, usage not adjusted", {
      workspaceId,
      relativePath,
    });
  }

  return { key: relativePath };
}

export async function getWorkspaceFile(
  workspaceId: string,
  relativePath: string,
): Promise<{ body: Readable; contentType?: string } | null> {
  ensureAllowedPrefix(relativePath);
  return getObject(workspaceId, relativePath);
}

export async function deleteWorkspaceFile(workspaceId: string, relativePath: string): Promise<void> {
  ensureAllowedPrefix(relativePath);
  const previousSize = await getWorkspaceObjectSize(workspaceId, relativePath);
  await deleteObject(workspaceId, relativePath);
  if (previousSize && previousSize > 0) {
    await adjustWorkspaceStorageUsageBytes(workspaceId, -previousSize);
  }
}

export async function generateWorkspaceFileDownloadUrl(
  workspaceId: string,
  relativePath: string,
  ttlSeconds = 900,
): Promise<{ url: string; expiresAt: string }> {
  ensureAllowedPrefix(relativePath);
  const bucket = await ensureWorkspaceBucketExists(workspaceId);
  const expiresIn = Math.max(60, Math.min(ttlSeconds, 60 * 60)); // 1 мин - 1 час
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: relativePath,
  });
  const url = await getSignedUrl(downloadMinioClient, command, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return { url, expiresAt };
}

// JSON Import Multipart Upload

const JSON_IMPORT_PART_SIZE = 10 * 1024 * 1024; // 10MB per part
const JSON_IMPORT_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

export interface InitMultipartUploadResult {
  uploadId: string;
  fileKey: string;
  partSize: number;
  totalParts: number;
}

export interface PresignedPartUrl {
  partNumber: number;
  url: string;
  expiresAt: string;
}

export async function initJsonImportMultipartUpload(
  workspaceId: string,
  fileName: string,
  fileSize: number,
  contentType: string = "application/json",
): Promise<InitMultipartUploadResult> {
  if (fileSize > JSON_IMPORT_MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${JSON_IMPORT_MAX_FILE_SIZE} bytes`);
  }

  try {
    const bucket = await ensureWorkspaceBucketExists(workspaceId);
    
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileKey = `json-imports/${timestamp}/${sanitizedFileName}`;

    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: contentType,
    });

    const response = await minioClient.send(command);
    
    if (!response.UploadId) {
      throw new Error("Failed to create multipart upload");
    }

    const totalParts = Math.ceil(fileSize / JSON_IMPORT_PART_SIZE);

    return {
      uploadId: response.UploadId,
      fileKey,
      partSize: JSON_IMPORT_PART_SIZE,
      totalParts,
    };
  } catch (error) {
    logger.error('[JSON-IMPORT-UPLOAD] Error in initJsonImportMultipartUpload', {
      error: error instanceof Error ? error.message : String(error),
      workspaceId,
      fileName,
    });
    
    // Преобразуем ошибки подключения к MinIO в понятные сообщения
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any)?.code || (error as any)?.name;
    
    // Проверяем на ошибки подключения к хранилищу
    if (
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ENOTFOUND' ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('connect') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('ECONNRESET')
    ) {
      const storageError = new Error('Не удалось подключиться к хранилищу файлов.');
      logger.error('[JSON-IMPORT-UPLOAD] Storage connection error', { 
        originalError: errorMessage, 
        errorCode,
        workspaceId 
      });
      throw storageError;
    }
    
    // Проверяем на другие ошибки S3/MinIO
    if (errorMessage.includes('NoSuchBucket') || errorMessage.includes('BucketNotFound')) {
      const bucketError = new Error('Бакет хранилища не найден. Обратитесь к администратору.');
      logger.error('[JSON-IMPORT-UPLOAD] Bucket not found', { originalError: errorMessage, workspaceId });
      throw bucketError;
    }
    
    // Для остальных ошибок возвращаем общее сообщение
    if (!errorMessage || errorMessage.trim() === '') {
      throw new Error('Не удалось инициализировать загрузку файла в хранилище.');
    }
    
    throw error;
  }
}

export async function generatePresignedPartUrls(
  workspaceId: string,
  fileKey: string,
  uploadId: string,
  totalParts: number,
): Promise<PresignedPartUrl[]> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);
  const expiresIn = 3600; // 1 hour

  const urls: PresignedPartUrl[] = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: fileKey,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const url = await getSignedUrl(minioClient, command, { expiresIn });
    urls.push({
      partNumber,
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
  }

  return urls;
}

export async function uploadJsonImportPart(
  workspaceId: string,
  fileKey: string,
  uploadId: string,
  partNumber: number,
  partData: Buffer | Readable,
): Promise<string> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);

  const command = new UploadPartCommand({
    Bucket: bucket,
    Key: fileKey,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: partData,
  });

  const response = await minioClient.send(command);
  if (!response.ETag) {
    throw new Error(`Failed to upload part ${partNumber}`);
  }

  // Remove quotes from ETag if present
  return response.ETag.replace(/^"|"$/g, "");
}

export async function completeJsonImportMultipartUpload(
  workspaceId: string,
  fileKey: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<{ fileKey: string; fileSize: number }> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);

  const completedParts: CompletedPart[] = parts.map((p) => ({
    PartNumber: p.partNumber,
    ETag: p.etag,
  }));

  const command = new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: fileKey,
    UploadId: uploadId,
    MultipartUpload: { Parts: completedParts },
  });

  const response = await minioClient.send(command);
  if (!response.Key) {
    throw new Error("Failed to complete multipart upload");
  }

  // Get file size
  const headResponse = await minioClient.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    }),
  );

  const fileSize = typeof headResponse.ContentLength === "number" ? headResponse.ContentLength : 0;

  // Update workspace storage usage
  await adjustWorkspaceStorageUsageBytes(workspaceId, fileSize);

  return { fileKey, fileSize };
}

export async function abortJsonImportMultipartUpload(
  workspaceId: string,
  fileKey: string,
  uploadId: string,
): Promise<void> {
  const bucket = await ensureWorkspaceBucketExists(workspaceId);

  const command = new AbortMultipartUploadCommand({
    Bucket: bucket,
    Key: fileKey,
    UploadId: uploadId,
  });

  await minioClient.send(command);
}

export async function deleteJsonImportFile(workspaceId: string, fileKey: string): Promise<void> {
  // fileKey should be like "json-imports/1234567890/file.json"
  if (!fileKey.startsWith("json-imports/")) {
    throw new Error("Invalid file key for JSON import");
  }

  await deleteWorkspaceFile(workspaceId, fileKey);
}

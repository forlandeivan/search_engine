import {
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";
import { downloadMinioClient, minioClient } from "./minio-client";
import { storage } from "./storage";
import { adjustWorkspaceStorageUsageBytes } from "./usage/usage-service";

const BUCKET_PREFIX = (process.env.WORKSPACE_BUCKET_PREFIX || "ws-").trim();

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
  } catch (error: any) {
    const code = error?.name || error?.Code || error?.code;
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
  await createBucketIfNeeded(bucketName);

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
  } catch (error: any) {
    const code = error?.name || error?.Code || error?.code;
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
  } catch (error) {
    const code = (error as any)?.name || (error as any)?.Code || (error as any)?.code;
    if (code === "NoSuchKey" || code === "NotFound") {
      console.warn("[workspace-storage] deleteObject: object missing (idempotent)", { bucket, key });
      return;
    }
    console.error("[workspace-storage] deleteObject failed", { bucket, key, error });
    throw error;
  }
}

const ALLOWED_PREFIXES = ["icons/", "files/", "attachments/"] as const;
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
  } catch (error: any) {
    const code = error?.name || error?.Code || error?.code;
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

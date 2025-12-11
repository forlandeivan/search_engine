import {
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import { minioClient } from "./minio-client";
import { storage } from "./storage";

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

/**
 * Единый интерфейс для загрузки файлов рабочего пространства.
 * Все новые фичи должны использовать этот слой, прямой доступ к minioClient запрещён.
 */
export async function uploadWorkspaceFile(
  workspaceId: string,
  relativePath: string,
  fileBuffer: Buffer | Readable,
  mimeType?: string,
): Promise<{ key: string }> {
  ensureAllowedPrefix(relativePath);
  await putObject(workspaceId, relativePath, fileBuffer, mimeType);
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
  await deleteObject(workspaceId, relativePath);
}

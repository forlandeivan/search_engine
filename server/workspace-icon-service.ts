import multer from "multer";
import {
  uploadWorkspaceFile,
  getWorkspaceFile,
  deleteWorkspaceFile,
  ensureWorkspaceBucketExists,
} from "./workspace-storage-service";
import { storage } from "./storage";
import type { Readable } from "stream";

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export const workspaceIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype.toLowerCase())) {
      return cb(new Error("only PNG, JPEG or SVG image formats are allowed"));
    }
    cb(null, true);
  },
});

export class WorkspaceIconError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WorkspaceIconError";
    this.status = status;
  }
}

function resolveExtension(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/svg+xml") return ".svg";
  return ".bin";
}

function buildPublicUrl(workspaceId: string): string {
  // Используем API-эндпоинт, чтобы избежать проблем с публичным доступом MinIO.
  return `/api/workspaces/${workspaceId}/icon?ts=${Date.now()}`;
}

export async function uploadWorkspaceIcon(
  workspaceId: string,
  file: Express.Multer.File,
): Promise<{ iconUrl: string; iconKey: string }> {
  if (!file) {
    throw new WorkspaceIconError("file is required", 400);
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new WorkspaceIconError("icon file size exceeds the allowed limit of 2 MB", 413);
  }
  if (!ALLOWED_MIME.includes(file.mimetype.toLowerCase())) {
    throw new WorkspaceIconError("only PNG, JPEG or SVG image formats are allowed", 400);
  }

  await ensureWorkspaceBucketExists(workspaceId);
  const ext = resolveExtension(file.mimetype.toLowerCase());
  const objectKey = `icons/icon${ext}`;

  await uploadWorkspaceFile(workspaceId, objectKey, file.buffer, file.mimetype, file.size);
  const publicUrl = buildPublicUrl(workspaceId);
  await storage.updateWorkspaceIcon(workspaceId, publicUrl, objectKey);

  return { iconUrl: publicUrl, iconKey: objectKey };
}

export async function clearWorkspaceIcon(workspaceId: string): Promise<void> {
  const workspace = await storage.getWorkspace(workspaceId);
  const key = workspace?.iconKey || null;
  if (workspace?.storageBucket && key) {
    try {
      await deleteWorkspaceFile(workspaceId, key);
    } catch (error) {
      console.error("[workspace-icon] failed to delete object", { workspaceId, key, error });
    }
  }
  await storage.updateWorkspaceIcon(workspaceId, null, null);
}

export async function getWorkspaceIcon(
  workspaceId: string,
): Promise<{ body: Readable; contentType?: string } | null> {
  const workspace = await storage.getWorkspace(workspaceId);
  const key = workspace?.iconKey;
  if (!key) return null;
  return await getWorkspaceFile(workspaceId, key);
}

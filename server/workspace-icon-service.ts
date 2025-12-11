import { randomBytes } from "crypto";
import path from "path";
import multer from "multer";
import { yandexObjectStorageService, type ObjectStorageCredentials } from "./yandex-object-storage-service";
import { db } from "./db";
import { workspaces } from "@shared/schema";
import { eq } from "drizzle-orm";

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

function generateObjectKey(originalName: string): string {
  const ext = path.extname(originalName || "").toLowerCase() || ".bin";
  const randomId = randomBytes(8).toString("hex");
  const safeName = (originalName || "icon")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .substring(0, 50)
    .replace(/_{2,}/g, "_");
  return `workspace-icons/${Date.now()}_${randomId}_${safeName}${ext}`;
}

export async function uploadWorkspaceIcon(
  workspaceId: string,
  file: Express.Multer.File,
  storageCredentials: ObjectStorageCredentials,
): Promise<string> {
  if (!file) {
    throw new WorkspaceIconError("file is required", 400);
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new WorkspaceIconError("icon file size exceeds the allowed limit of 2 MB", 413);
  }
  if (!ALLOWED_MIME.includes(file.mimetype.toLowerCase())) {
    throw new WorkspaceIconError("only PNG, JPEG or SVG image formats are allowed", 400);
  }

  const objectKey = generateObjectKey(file.originalname || "icon");
  const uploadResult = await yandexObjectStorageService.uploadFile(
    file.buffer,
    file.mimetype,
    storageCredentials,
    objectKey,
  );

  await db.update(workspaces).set({ iconUrl: uploadResult.uri }).where(eq(workspaces.id, workspaceId));
  return uploadResult.uri;
}

export async function clearWorkspaceIcon(workspaceId: string): Promise<void> {
  await db.update(workspaces).set({ iconUrl: null }).where(eq(workspaces.id, workspaceId));
}

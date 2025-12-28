import type { FileStorageType } from "@shared/schema";

export type StorageRoutingTarget = {
  storageType: FileStorageType;
  providerId?: string | null;
  reason?: string;
};

export class ExternalStorageNotImplementedError extends Error {
  constructor(message = "External file storage integration is not implemented yet") {
    super(message);
    this.name = "ExternalStorageNotImplementedError";
  }
}

/**
 * Lightweight resolver to decide where to store files.
 * Standard skills -> MinIO. No-code -> external provider (stubbed for now).
 */
export async function resolveStorageTarget(opts: {
  workspaceId: string;
  skillExecutionMode?: string | null;
}): Promise<StorageRoutingTarget> {
  if (opts.skillExecutionMode === "no_code") {
    return {
      storageType: "external_provider",
      providerId: null,
      reason: "No-code skill requires external file storage (integration pending in epics 3–5)",
    };
  }

  return { storageType: "standard_minio" };
}

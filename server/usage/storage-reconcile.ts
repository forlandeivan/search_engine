import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { minioClient } from "../minio-client";
import { storage } from "../storage";
import { getWorkspaceBucketName } from "../workspace-storage-service";
import { adjustWorkspaceStorageUsageBytes, getWorkspaceUsage } from "./usage-service";
import type { UsagePeriod } from "./usage-types";

/**
 * Подсчёт суммарного размера объектов в бакете workspace.
 * Используем пагинацию ListObjectsV2, не держим в памяти список ключей.
 */
export async function calculateWorkspaceStorageBytes(workspaceId: string): Promise<number> {
  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found for storage reconcile`);
  }

  const bucket = workspace.storageBucket || getWorkspaceBucketName(workspaceId);
  let continuationToken: string | undefined;
  let totalBytes = 0;

  do {
    const response = await minioClient.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );

    if (response.Contents && Array.isArray(response.Contents)) {
      for (const item of response.Contents) {
        if (typeof item.Size === "number") {
          totalBytes += item.Size;
        }
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken ?? undefined : undefined;
  } while (continuationToken);

  return totalBytes;
}

/**
 * Обновление агрегата storage_bytes по факту пересчёта из MinIO.
 * Планируется запускаться из cron/worker пакетно по workspaces.
 */
export async function reconcileWorkspaceStorageUsage(
  workspaceId: string,
  period?: UsagePeriod,
): Promise<{ workspaceId: string; previousBytes: number; nextBytes: number; updated: boolean }> {
  const usage = await getWorkspaceUsage(workspaceId, period);
  const currentBytes = Number(usage?.storageBytesTotal ?? 0);
  const actualBytes = await calculateWorkspaceStorageBytes(workspaceId);

  if (actualBytes === currentBytes) {
    return { workspaceId, previousBytes: currentBytes, nextBytes: actualBytes, updated: false };
  }

  await adjustWorkspaceStorageUsageBytes(workspaceId, actualBytes - currentBytes, period);
  return { workspaceId, previousBytes: currentBytes, nextBytes: actualBytes, updated: true };
}

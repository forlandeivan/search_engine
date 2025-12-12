import { adjustWorkspaceStorageUsageBytes, getWorkspaceUsage, ensureWorkspaceUsage } from "./usage-service";
import type { UsagePeriod } from "./usage-types";

/**
 * Заготовка для пересчёта объёма хранилища по workspace.
 * TODO: реализовать listing объектов в MinIO (bucket-per-workspace или общий bucket+prefix) и вернуть фактический размер.
 */
export async function calculateWorkspaceStorageBytes(_workspaceId: string): Promise<number> {
  // План: использовать MinIO/S3 listObjects с пагинацией, суммировать contentLength.
  // Пока не реализовано — вернём 0, чтобы не падать при случайном вызове.
  return 0;
}

/**
 * Обновление агрегата storage_bytes по факту пересчёта из MinIO.
 * TODO: интегрировать с планируемым cron/worker и заменить фиктивный пересчёт.
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

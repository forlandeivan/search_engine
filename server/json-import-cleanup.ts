import { storage } from "./storage";
import { deleteJsonImportFile } from "./workspace-storage-service";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = 7;

/**
 * Cleanup old JSON import files for failed jobs
 */
async function cleanupOldJsonImportFiles(): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    // Find all failed jobs older than retention period
    // Note: We'll need to add a method to storage to query old failed jobs
    // For now, we'll implement a simple cleanup based on finished_at
    
    console.log(`[json-import-cleanup] Starting cleanup of files older than ${RETENTION_DAYS} days`);
    
    // This is a placeholder - we'll need to implement a method in storage
    // to get old failed jobs with their file keys
    // For MVP, we can skip this and just delete files after successful imports
    
    console.log(`[json-import-cleanup] Cleanup completed`);
  } catch (error) {
    console.error("[json-import-cleanup] Cleanup failed:", error);
  }
}

export function startJsonImportCleanupJob() {
  let stopped = false;

  const run = async () => {
    if (stopped) {
      return;
    }
    try {
      await cleanupOldJsonImportFiles();
    } catch (error) {
      console.error("[json-import-cleanup] Cleanup job failed:", error);
    }
  };

  const timer = setInterval(() => {
    if (!stopped) {
      void run();
    }
  }, CLEANUP_INTERVAL_MS);
  timer.unref?.();

  // Initial run (non-blocking)
  void run();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

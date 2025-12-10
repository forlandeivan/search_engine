import { systemNotificationLogService } from "./system-notification-log-service";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function resolveSystemNotificationLogRetentionOptions() {
  return {
    retentionDays: parsePositiveInt(process.env.SYSTEM_NOTIFICATION_LOG_RETENTION_DAYS, 90),
    cleanupIntervalMinutes: parsePositiveInt(process.env.SYSTEM_NOTIFICATION_LOG_RETENTION_INTERVAL_MINUTES, 60),
  };
}

export function startSystemNotificationLogRetentionJob() {
  const options = resolveSystemNotificationLogRetentionOptions();
  if (!Number.isFinite(options.retentionDays) || options.retentionDays <= 0) {
    console.info("[notify-log] retention disabled (non-positive retention days)");
    return null;
  }

  const intervalMs = Math.max(1, options.cleanupIntervalMinutes) * 60 * 1000;
  let stopped = false;

  const run = async () => {
    try {
      const deleted = await systemNotificationLogService.cleanupOldLogs(options.retentionDays);
      if (deleted > 0) {
        console.info(
          `[notify-log] retention cleaned ${deleted} notification logs older than ${options.retentionDays} days`,
        );
      }
    } catch (error) {
      console.error("[notify-log] retention job failed:", error);
    }
  };

  const timer = setInterval(() => {
    if (!stopped) {
      void run();
    }
  }, intervalMs);
  timer.unref?.();

  // first non-blocking run
  void run();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

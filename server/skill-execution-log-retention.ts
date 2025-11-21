import { skillExecutionLogService } from "./skill-execution-log-context";
import type { SkillExecutionLogService } from "./skill-execution-log-service";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SkillExecutionLogRetentionOptions {
  retentionDays: number;
  cleanupIntervalMinutes: number;
  batchSize: number;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function resolveSkillExecutionLogRetentionOptions(): SkillExecutionLogRetentionOptions {
  return {
    retentionDays: parsePositiveInteger(process.env.SKILL_EXECUTION_LOG_RETENTION_DAYS, 30),
    cleanupIntervalMinutes: parsePositiveInteger(process.env.SKILL_EXECUTION_LOG_RETENTION_INTERVAL_MINUTES, 60),
    batchSize: parsePositiveInteger(process.env.SKILL_EXECUTION_LOG_RETENTION_BATCH_SIZE, 100),
  };
}

export async function runSkillExecutionLogRetentionCleanup(
  options?: Partial<SkillExecutionLogRetentionOptions> & { now?: Date; service?: SkillExecutionLogService },
) {
  const resolved = { ...resolveSkillExecutionLogRetentionOptions(), ...options };
  if (!Number.isFinite(resolved.retentionDays) || resolved.retentionDays <= 0) {
    return { deleted: 0 };
  }
  const service = options?.service ?? skillExecutionLogService;
  const now = options?.now ?? new Date();
  const cutoff = new Date(now.getTime() - resolved.retentionDays * DAY_MS);
  const executions = await service.listExecutions();
  const candidates = executions.filter((execution) => execution.startedAt < cutoff);
  if (candidates.length === 0) {
    return { deleted: 0 };
  }

  let deleted = 0;
  for (let index = 0; index < candidates.length; index += resolved.batchSize) {
    const batch = candidates.slice(index, index + resolved.batchSize);
    const ids = batch.map((execution) => execution.id);
    deleted += await service.deleteExecutions(ids);
  }

  console.info(
    `[skill-log] retention cleaned ${deleted} executions older than ${resolved.retentionDays} days (cutoff ${cutoff.toISOString()})`,
  );
  return { deleted };
}

export function startSkillExecutionLogRetentionJob() {
  const options = resolveSkillExecutionLogRetentionOptions();
  if (!Number.isFinite(options.retentionDays) || options.retentionDays <= 0) {
    console.info("[skill-log] retention job disabled (non-positive retention days)");
    return null;
  }

  const intervalMs = Math.max(options.cleanupIntervalMinutes, 1) * 60 * 1000;
  let stopped = false;

  const run = () => {
    runSkillExecutionLogRetentionCleanup().catch((error) => {
      console.error("[skill-log] retention job failed:", error);
    });
  };

  const timer = setInterval(() => {
    if (!stopped) {
      run();
    }
  }, intervalMs);
  timer.unref?.();

  // initial run but non-blocking
  run();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

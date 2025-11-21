import { format } from "date-fns";

export function formatExecutionTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return format(date, "dd.MM.yyyy HH:mm");
}

export function formatExecutionDuration(durationMs: number | null) {
  if (!durationMs || Number.isNaN(durationMs)) {
    return "—";
  }
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

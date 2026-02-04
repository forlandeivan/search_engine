import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { MaintenanceModeStatusDto } from "@shared/maintenance-mode";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const QUARTER_HOUR_MS = 15 * 60 * 1000;

type BannerTone = "neutral" | "warning" | "critical";

const parseDate = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const resolveNow = (status: MaintenanceModeStatusDto) => {
  return parseDate(status.serverTime) ?? new Date();
};

const getScheduleDeltaMs = (status: MaintenanceModeStatusDto) => {
  const start = parseDate(status.scheduledStartAt);
  if (!start) return null;
  return start.getTime() - resolveNow(status).getTime();
};

export const shouldShowMaintenanceBanner = (status: MaintenanceModeStatusDto) => {
  const deltaMs = getScheduleDeltaMs(status);
  if (deltaMs === null) return true;
  return deltaMs <= DAY_MS;
};

const resolveBannerTone = (status: MaintenanceModeStatusDto): BannerTone => {
  const deltaMs = getScheduleDeltaMs(status);
  if (deltaMs === null) return "warning";
  if (deltaMs <= QUARTER_HOUR_MS) return "critical";
  if (deltaMs <= HOUR_MS) return "warning";
  return "neutral";
};

const baseBannerClassName =
  "w-full rounded-none border-x-0 border-t-0 py-3 text-foreground [&>svg]:left-4 [&>svg]:top-1/2 [&>svg]:-translate-y-1/2 [&>svg+div]:translate-y-0";

const toneStyles: Record<
  BannerTone,
  { container: string; description: string; meta: string }
> = {
  neutral: {
    container: "border-border bg-background text-foreground [&>svg]:text-foreground",
    description: "text-foreground",
    meta: "text-foreground",
  },
  warning: {
    container:
      "border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50 dark:[&>svg]:text-amber-400",
    description: "text-amber-800 dark:text-amber-200",
    meta: "text-amber-800 dark:text-amber-200",
  },
  critical: {
    container:
      "border-red-200 bg-red-50 text-red-900 [&>svg]:text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-50 dark:[&>svg]:text-red-400",
    description: "text-red-800 dark:text-red-200",
    meta: "text-red-800 dark:text-red-200",
  },
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export type MaintenanceBannerProps = {
  status: MaintenanceModeStatusDto;
};

export function MaintenanceBanner({ status }: MaintenanceBannerProps) {
  if (!shouldShowMaintenanceBanner(status)) {
    return null;
  }

  const tone = resolveBannerTone(status);
  const styles = toneStyles[tone];
  const startLabel = formatDateTime(status.scheduledStartAt);
  const endLabel = formatDateTime(status.scheduledEndAt);
  const title = status.messageTitle?.trim() || "Плановое обслуживание";
  const description = status.messageBody?.trim();
  const eta = status.publicEta?.trim();

  return (
    <Alert
      className={`${baseBannerClassName} ${styles.container}`}
      data-testid="maintenance-banner"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="mx-auto flex w-full flex-1 flex-wrap items-center justify-between gap-3 pr-4">
        <div className="space-y-0.5">
          <AlertTitle className="mb-0">{title}</AlertTitle>
          {description ? (
            <AlertDescription className={styles.description}>
              {description}
            </AlertDescription>
          ) : null}
        </div>
        <div className={`flex flex-wrap items-center gap-3 text-sm ${styles.meta}`}>
          {startLabel ? <span>Старт: {startLabel}</span> : null}
          {eta ? <span>Окончание: {eta}</span> : endLabel ? <span>Окончание: {endLabel}</span> : null}
        </div>
      </div>
    </Alert>
  );
}

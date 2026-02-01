import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { MaintenanceModeStatusDto } from "@shared/maintenance-mode";

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
  const startLabel = formatDateTime(status.scheduledStartAt);
  const endLabel = formatDateTime(status.scheduledEndAt);
  const title = status.messageTitle?.trim() || "Плановое обслуживание";
  const description = status.messageBody?.trim();
  const eta = status.publicEta?.trim();

  return (
    <Alert
      className="w-full rounded-none border-x-0 border-t-0 border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50 dark:[&>svg]:text-amber-400"
      data-testid="maintenance-banner"
    >
      <AlertTriangle className="h-4 w-4" />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-wrap items-start justify-between gap-3 pr-4">
        <div className="space-y-1">
          <AlertTitle className="mb-0">{title}</AlertTitle>
          {description ? (
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              {description}
            </AlertDescription>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-amber-800 dark:text-amber-200">
          {startLabel ? <span>Старт: {startLabel}</span> : null}
          {eta ? <span>Окончание: {eta}</span> : endLabel ? <span>Окончание: {endLabel}</span> : null}
        </div>
      </div>
    </Alert>
  );
}

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
    <div
      className="w-full border-b border-amber-500/40 bg-amber-500/10"
      data-testid="maintenance-banner"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm text-amber-950">
        <div className="space-y-1">
          <div className="font-semibold">{title}</div>
          {description ? <div className="text-amber-900/80">{description}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-amber-900/90">
          {startLabel ? <span>Старт: {startLabel}</span> : null}
          {eta ? <span>Окончание: {eta}</span> : endLabel ? <span>Окончание: {endLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}

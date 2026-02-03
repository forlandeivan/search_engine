import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { MaintenanceModeStatusDto } from "@shared/maintenance-mode";

export type MaintenanceOverlayProps = {
  status?: MaintenanceModeStatusDto | null;
  safeMode?: boolean;
  isAdmin?: boolean;
};

const THEME_KEY = "theme";

function useIsDarkMode(): boolean {
  const readDark = (): boolean => {
    if (typeof document === "undefined") return false;
    if (document.documentElement.classList.contains("dark")) return true;
    return localStorage.getItem(THEME_KEY) === "dark";
  };
  const [isDark, setIsDark] = useState(readDark);
  useEffect(() => {
    const el = document.documentElement;
    const check = () => setIsDark(readDark());
    const observer = new MutationObserver(check);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setIsDark(readDark());
    };
    window.addEventListener("storage", onStorage);
    check();
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return isDark;
}

export function MaintenanceOverlay({ status, safeMode = false, isAdmin = false }: MaintenanceOverlayProps) {
  const isDark = useIsDarkMode();
  const isActive = status?.status === "active";
  const title = safeMode
    ? "Сервис временно недоступен"
    : status?.messageTitle?.trim() || "Идут технические работы";
  const description = safeMode ? null : (status?.messageBody?.trim() || null);
  const publicEtaText = status?.publicEta?.trim();
  const scheduledEndAtDate = status?.scheduledEndAt ? new Date(status.scheduledEndAt) : null;
  const scheduledEndAtInPast =
    scheduledEndAtDate && !Number.isNaN(scheduledEndAtDate.getTime()) && scheduledEndAtDate.getTime() < Date.now();
  const scheduledEndAtFormatted =
    scheduledEndAtDate && !Number.isNaN(scheduledEndAtDate.getTime())
      ? scheduledEndAtDate.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
      : null;
  const etaDisplay =
    publicEtaText || (scheduledEndAtInPast ? null : scheduledEndAtFormatted) || null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex min-h-screen items-center justify-center px-4 py-10 backdrop-blur bg-background/90 ${isDark ? "bg-black/90" : "bg-background/90"}`}
      data-testid="maintenance-overlay"
    >
      <Empty

      >
        <EmptyMedia
          variant="icon"
        >
          <Wrench />
        </EmptyMedia>
        <EmptyTitle
          className={isDark ? "text-white text-2xl font-semibold" : "text-2xl font-semibold"}
        >
          {title}
        </EmptyTitle>
        {description ? (
          <EmptyDescription
            className={isDark ? "text-zinc-200" : "text-foreground/90"}
          >
            {description}
          </EmptyDescription>
        ) : null}
        {etaDisplay ? (
          <EmptyDescription
            className={isDark ? "text-white" : "text-foreground"}
          >
            Ожидаем восстановление: {etaDisplay}
          </EmptyDescription>
        ) : null}
        <EmptyContent className="gap-4">
          {isAdmin ? (
            <Button variant="outline" asChild>
              <Link href="/admin/settings/maintenance">
                <Wrench className="mr-2 h-4 w-4" />
                Управление режимом обслуживания
              </Link>
            </Button>
          ) : null}
          {!isActive && safeMode ? (
            <p className={cn("text-xs", isDark ? "text-zinc-400" : "text-foreground/70")}>
              Если сообщение не исчезает, попробуйте обновить страницу позже.
            </p>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  );
}

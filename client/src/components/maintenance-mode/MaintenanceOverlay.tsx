import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
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
      <div
        className={`w-full max-w-xl space-y-4 p-6 text-center  ${
          isDark ? "border-zinc-700 bg-zinc-900" : "border-border/60 bg-background"
        }`}
      >
        <div
          className={`text-2xl font-semibold ${isDark ? "text-white" : "text-foreground"}`}
        >
          {title}
        </div>
        {description ? (
          <p className={`text-base ${isDark ? "text-zinc-200" : "text-foreground/90"}`}>
            {description}
          </p>
        ) : null}
        {etaDisplay ? (
          <div
            className={`text-sm ${isDark ? "text-white" : "text-foreground"}`}
          >
            Ожидаем восстановление: {etaDisplay}
          </div>
        ) : null}

        {isAdmin ? (
          <div className="pt-2">
            <Button variant="outline" asChild>
              <Link href="/admin/settings/maintenance">
                <Wrench className="mr-2 h-4 w-4" />
                Управление режимом обслуживания
              </Link>
            </Button>
          </div>
        ) : null}
        {!isActive && safeMode ? (
          <p className={`text-xs ${isDark ? "text-zinc-400" : "text-foreground/70"}`}>
            Если сообщение не исчезает, попробуйте обновить страницу позже.
          </p>
        ) : null}
      </div>
    </div>
  );
}

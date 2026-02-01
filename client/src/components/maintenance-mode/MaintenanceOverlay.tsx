import { Link } from "wouter";
import { Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MaintenanceModeStatusDto } from "@shared/maintenance-mode";

export type MaintenanceOverlayProps = {
  status?: MaintenanceModeStatusDto | null;
  safeMode?: boolean;
  isAdmin?: boolean;
};

export function MaintenanceOverlay({ status, safeMode = false, isAdmin = false }: MaintenanceOverlayProps) {
  const isActive = status?.status === "active";
  const title = safeMode
    ? "Сервис временно недоступен"
    : status?.messageTitle?.trim() || "Идут технические работы";
  const description = safeMode
    ? "Не удалось получить статус обслуживания. Мы уже разбираемся."
    : status?.messageBody?.trim() || "Мы обновляем систему и скоро вернемся.";
  const eta = status?.publicEta?.trim();

  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-background/90 px-4 py-10 backdrop-blur"
      data-testid="maintenance-overlay"
    >
      <div className="w-full max-w-xl space-y-4 rounded-2xl border border-border/60 bg-background p-6 text-center shadow-lg">
        <div className="text-2xl font-semibold text-foreground">{title}</div>
        <p className="text-base text-muted-foreground">{description}</p>
        {eta ? (
          <div className="rounded-lg bg-muted px-4 py-2 text-sm text-foreground">Ожидаем восстановление: {eta}</div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Следите за обновлениями — мы скоро вернемся.
        </p>
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
          <p className="text-xs text-muted-foreground">Если сообщение не исчезает, попробуйте обновить страницу позже.</p>
        ) : null}
      </div>
    </div>
  );
}

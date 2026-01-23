import { LayoutDashboard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type DashboardHeaderProps = {
  workspaceName?: string;
  isLoading?: boolean;
};

export function DashboardHeader({ workspaceName, isLoading }: DashboardHeaderProps) {
  return (
    <header className="flex flex-wrap items-start gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <LayoutDashboard className="h-5 w-5" />
          Домашняя страница рабочего пространства
        </div>
        {isLoading ? (
          <>
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-5 w-96" />
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold">Unica AI Дашборд</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {workspaceName ? (
                <>Рабочее пространство: <span className="font-medium">{workspaceName}</span></>
              ) : (
                "Управляйте навыками, чатами и базами знаний в едином интерфейсе"
              )}
            </p>
          </>
        )}
      </div>
    </header>
  );
}

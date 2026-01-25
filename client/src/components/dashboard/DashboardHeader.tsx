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
        {isLoading ? (
          <>
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-5 w-96" />
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold">Дашборд</h1>

          </>
        )}
      </div>
    </header>
  );
}

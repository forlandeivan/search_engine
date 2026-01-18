/**
 * Actions Preview for New Skill Component
 *
 * Displays available actions that will be available after skill creation
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { ActionDto } from "@shared/skills";

export function ActionsPreviewForNewSkill() {
  const { data, isLoading, isError } = useQuery<{ actions: ActionDto[] }>({
    queryKey: ["/api/actions/available"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/actions/available");
      if (!response.ok) {
        return { actions: [] };
      }
      return (await response.json()) as { actions: ActionDto[] };
    },
  });

  const actions = data?.actions ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка действий...
      </div>
    );
  }

  if (isError || actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
        Действия будут доступны после сохранения навыка.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        После сохранения навыка вы сможете настроить следующие действия:
      </p>
      <div className="flex flex-wrap gap-1">
        {actions.map((action) => (
          <Badge key={action.id} variant="secondary" className="text-xs">
            {action.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

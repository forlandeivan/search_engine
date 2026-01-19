import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveIndexingActions } from "@/hooks/useActiveIndexingActions";
import { IndexingProgressCard } from "./IndexingProgressCard";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "global_indexing_progress_minimized";

export function GlobalIndexingProgress({ workspaceId }: { workspaceId: string | null }) {
  const { data: actions = [], isLoading } = useActiveIndexingActions(workspaceId);
  const [minimized, setMinimized] = useState<Set<string>>(new Set());

  // Восстанавливаем состояние минимизации из localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        setMinimized(new Set(parsed));
      }
    } catch {
      // Игнорируем ошибки парсинга
    }
  }, []);

  // Сохраняем состояние минимизации в localStorage
  const handleMinimize = (baseId: string) => {
    const newMinimized = new Set(minimized);
    newMinimized.add(baseId);
    setMinimized(newMinimized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(newMinimized)));
    } catch {
      // Игнорируем ошибки сохранения
    }
  };

  const handleExpand = (baseId: string) => {
    const newMinimized = new Set(minimized);
    newMinimized.delete(baseId);
    setMinimized(newMinimized);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(newMinimized)));
    } catch {
      // Игнорируем ошибки сохранения
    }
  };

  // Очищаем завершённые индексации из minimized
  useEffect(() => {
    const terminalStatuses = ["done", "error", "canceled"];
    const activeBaseIds = new Set(
      actions.filter((a) => !terminalStatuses.includes(a.status)).map((a) => a.baseId),
    );

    const newMinimized = new Set(minimized);
    let changed = false;
    for (const baseId of minimized) {
      if (!activeBaseIds.has(baseId)) {
        newMinimized.delete(baseId);
        changed = true;
      }
    }

    if (changed) {
      setMinimized(newMinimized);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(newMinimized)));
      } catch {
        // Игнорируем ошибки сохранения
      }
    }
  }, [actions, minimized]);

  if (isLoading || actions.length === 0) {
    return null;
  }

  const activeActions = actions.filter(
    (action) => action.status === "processing" || action.status === "paused",
  );

  if (activeActions.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm space-y-2">
      {activeActions.map((action) => {
        const isMinimized = minimized.has(action.baseId);
        return (
          <div key={action.actionId} className="relative">
            {isMinimized ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Индексация: {action.baseName}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleExpand(action.baseId)}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <IndexingProgressCard
                action={action}
                baseName={action.baseName}
                onMinimize={() => handleMinimize(action.baseId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

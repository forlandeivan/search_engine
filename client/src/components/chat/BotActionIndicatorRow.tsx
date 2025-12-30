import { useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BotAction } from "@shared/schema";
import { resolveBotActionText } from "@/lib/botAction";

type BotActionIndicatorRowProps = {
  action: BotAction | null;
  fallbackText?: string;
  otherActiveCount?: number; // Количество других активных actions (для счётчика "+N")
};

const AUTO_HIDE_MS = 1800;

export function BotActionIndicatorRow({ action, fallbackText, otherActiveCount }: BotActionIndicatorRowProps) {
  const [hidden, setHidden] = useState(false);

  const text = useMemo(() => resolveBotActionText(action) ?? fallbackText ?? null, [action, fallbackText]);
  const status = action?.status ?? "processing";
  const visible = Boolean(action) && Boolean(text);

  useEffect(() => {
    setHidden(false);
    if (!visible) {
      return;
    }
    if (status === "done" || status === "error") {
      const timer = setTimeout(() => setHidden(true), AUTO_HIDE_MS);
      return () => clearTimeout(timer);
    }
    return;
  }, [visible, status, text]);

  const icon = useMemo(() => {
    if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    if (status === "error") return <AlertCircle className="h-4 w-4 text-red-600" />;
    return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  }, [status]);

  if (!visible || hidden || !text) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-slate-200 bg-white/80 px-6 py-3 text-sm text-slate-800",
        "dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100",
      )}
      data-testid="bot-action-indicator-row"
    >
      {icon}
      <span className="truncate">{text}</span>
      {otherActiveCount !== undefined && otherActiveCount > 0 && (
        <span className="ml-1 shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          +{otherActiveCount}
        </span>
      )}
    </div>
  );
}

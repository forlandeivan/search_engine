/**
 * Generative Loading State Component
 *
 * Displays loading state for generative search operations
 */

import { Sparkles } from "lucide-react";

function GenerativeLoadingDots() {
  return (
    <span className="flex items-center gap-1 text-primary" aria-hidden>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: "150ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

export function GenerativeLoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 p-3"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">Генерируем ответ...</span>
          <span className="text-xs text-muted-foreground">Запрос отправлен в LLM, подождите немного.</span>
        </div>
      </div>
      <GenerativeLoadingDots />
    </div>
  );
}

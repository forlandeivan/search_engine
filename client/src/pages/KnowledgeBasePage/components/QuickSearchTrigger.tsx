/**
 * Quick Search Trigger Component
 * 
 * A search input that opens a quick search dialog on focus or keyboard shortcut.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuickSearchTriggerProps } from "../types";

export function QuickSearchTrigger({
  query,
  placeholder,
  isOpen,
  onOpen,
  onOpenStateChange,
}: QuickSearchTriggerProps) {
  const [isApplePlatform, setIsApplePlatform] = useState(false);
  const previousIsOpenRef = useRef(isOpen);
  const skipNextFocusRef = useRef(false);

  useEffect(() => {
    onOpenStateChange(isOpen);
  }, [isOpen, onOpenStateChange]);

  useEffect(() => {
    if (previousIsOpenRef.current && !isOpen) {
      skipNextFocusRef.current = true;
    }
    previousIsOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    const platform = navigator.userAgent || navigator.platform || "";
    setIsApplePlatform(/Mac|iP(ad|hone|od)/i.test(platform));
  }, []);

  const handleOpen = useCallback(() => {
    onOpen();
  }, [onOpen]);

  const handleFocus = useCallback(() => {
    if (skipNextFocusRef.current) {
      skipNextFocusRef.current = false;
      return;
    }

    handleOpen();
  }, [handleOpen]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpen();
        return;
      }

      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        handleOpen();
      }
    },
    [handleOpen],
  );

  const displayText = query.trim() ? query : placeholder;
  const isPlaceholder = !query.trim();
  const hotkeyLabel = isApplePlatform ? "⌘K" : "Ctrl+K";

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-3 rounded-md border border-input bg-card px-3 py-2 text-left text-sm shadow-sm transition",
        isOpen && "border-primary ring-2 ring-primary/30",
      )}
      onClick={handleOpen}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
    >
      <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className={cn("flex-1 truncate", isPlaceholder ? "text-muted-foreground" : "text-foreground")}>
        {displayText}
      </span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <kbd className="rounded border border-input bg-background px-1.5 py-0.5 text-[10px] leading-none">{hotkeyLabel}</kbd>
      </span>
    </button>
  );
}

export default QuickSearchTrigger;

import { useEffect, useMemo, useRef, useState } from "react";

import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { BookOpen, FileText, Layers, Link as LinkIcon, Search, Sparkles, Tag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SuggestResponseItem, SuggestResponsePayload } from "@/types/search";

const GROUP_ITEM_LIMIT = 5;
const ASK_AI_MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 150;

interface SearchQuickSwitcherProps {
  query: string;
  isAskAiEnabled: boolean;
  suggest: SuggestResponsePayload | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  onQueryChange: (value: string) => void;
  onAskAi: (query: string) => Promise<void> | void;
  onResultOpen?: (section: SuggestResponseItem, options?: { newTab?: boolean }) => void;
  onClose?: () => void;
  onPrefetch?: (query: string) => void;
  closeOnAsk?: boolean;
  disabledReason?: string | null;
}

interface ResultGroup {
  id: string;
  title: string;
  items: SuggestResponseItem[];
  hasMore: boolean;
}

type VirtualRow =
  | { type: "group"; groupIndex: number }
  | { type: "item"; groupIndex: number; itemIndex: number }
  | { type: "more"; groupIndex: number };

const STATUS_BAR_SHORTCUTS = [
  { label: "Навигация", value: "↑/↓" },
  { label: "Группы", value: "Tab" },
  { label: "Новая вкладка", value: "⇧↵" },
  { label: "Ask AI", value: "⌘↵" },
  { label: "Закрыть", value: "Esc" },
];

const noop = () => {};

function normalizeString(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function buildGroups(payload: SuggestResponsePayload | null): ResultGroup[] {
  if (!payload || !Array.isArray(payload.groups) || payload.groups.length === 0) {
    return [];
  }

  return payload.groups.map((group) => ({
    id: group.id,
    title: normalizeString(group.title) || group.id,
    hasMore: Boolean(group.hasMore && group.items.length > GROUP_ITEM_LIMIT),
    items: group.items.slice(0, GROUP_ITEM_LIMIT),
  }));
}

function tokenize(query: string) {
  return query
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return "…";
  }

  const half = Math.floor((maxLength - 1) / 2);
  const start = value.slice(0, half);
  const end = value.slice(value.length - (maxLength - half - 1));
  return `${start}…${end}`;
}

function truncateEnd(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return "…";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function highlightText(text: string, tokens: string[]) {
  if (!tokens.length) {
    return text;
  }

  const parts: Array<string | JSX.Element> = [];
  const lowerText = text.toLowerCase();
  let indexOffset = 0;

  while (indexOffset < text.length) {
    let matchIndex = -1;
    let matchLength = 0;
    let matchToken = "";

    for (const token of tokens) {
      const idx = lowerText.indexOf(token.toLowerCase(), indexOffset);
      if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
        matchIndex = idx;
        matchLength = token.length;
        matchToken = token;
      }
    }

    if (matchIndex === -1) {
      parts.push(text.slice(indexOffset));
      break;
    }

    if (matchIndex > indexOffset) {
      parts.push(text.slice(indexOffset, matchIndex));
    }

    const matchedText = text.slice(matchIndex, matchIndex + matchLength);
    parts.push(<mark key={`${matchIndex}-${matchToken}`}>{matchedText}</mark>);
    indexOffset = matchIndex + matchLength;
  }

  return parts;
}

function getDisplayTitle(item: SuggestResponseItem) {
  const heading = normalizeString(item.heading_text);
  if (heading) {
    return heading;
  }

  const title = normalizeString(item.title);
  if (title) {
    return title;
  }

  const path = normalizeString(item.path);
  if (path) {
    return humanizeSlug(path.split("/").pop() ?? path);
  }

  const url = normalizeString(item.url);
  if (url) {
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const parsed = new URL(url, base);
      const segment = parsed.pathname.split("/").filter(Boolean).pop();
      if (segment) {
        return humanizeSlug(segment);
      }
      return parsed.hostname;
    } catch {
      const segment = url.split("/").filter(Boolean).pop();
      if (segment) {
        return humanizeSlug(segment);
      }
    }
  }

  return "";
}

function humanizeSlug(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBreadcrumbs(item: SuggestResponseItem) {
  const breadcrumbs = (item.breadcrumbs ?? []).map(normalizeString).filter(Boolean);
  if (breadcrumbs.length > 0) {
    return breadcrumbs.join(" › ");
  }

  const path = normalizeString(item.path);
  if (path) {
    return path;
  }

  const url = normalizeString(item.url);
  if (url) {
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      const parsed = new URL(url, base);
      return parsed.pathname.replace(/^\/+/, "");
    } catch {
      return url.replace(/^https?:\/\//i, "");
    }
  }

  return "";
}

function buildMetaChips(item: SuggestResponseItem) {
  const meta: { key: string; label: string }[] = [];

  const version = normalizeString(item.version);
  if (version) {
    meta.push({ key: "version", label: version.startsWith("v") ? version : `v${version}` });
  }

  const language = normalizeString(item.language);
  if (language) {
    meta.push({ key: "language", label: language.toUpperCase() });
  }

  const type = normalizeString(item.type);
  if (type) {
    meta.push({ key: "type", label: type });
  }

  if (meta.length === 0) {
    return null;
  }

  const primary = meta.slice(0, 2);
  const overflow = meta.slice(2);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {primary.map((chip) => (
        <Badge key={chip.key} variant="outline" className="max-w-[72px] truncate text-[10px]">
          {chip.label}
        </Badge>
      ))}
      {overflow.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px]">
                +{overflow.length}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              <div className="flex flex-col gap-1">
                {overflow.map((chip) => (
                  <span key={chip.key}>{chip.label}</span>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

function buildVirtualRows(groups: ResultGroup[]): VirtualRow[] {
  const rows: VirtualRow[] = [];

  groups.forEach((group, groupIndex) => {
    rows.push({ type: "group", groupIndex });
    group.items.forEach((_, itemIndex) => {
      rows.push({ type: "item", groupIndex, itemIndex });
    });
    if (group.hasMore) {
      rows.push({ type: "more", groupIndex });
    }
  });

  return rows;
}

function getOptionId(groupIndex: number, itemIndex: number) {
  return `search-option-${groupIndex}-${itemIndex}`;
}

export function SearchQuickSwitcher({
  query,
  suggest,
  status,
  error,
  onQueryChange,
  onAskAi,
  onResultOpen = noop,
  onClose,
  onPrefetch,
  isAskAiEnabled,
  closeOnAsk = true,
  disabledReason,
}: SearchQuickSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [localQuery, setLocalQuery] = useState(query);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const [lastInputTime, setLastInputTime] = useState<number>(0);

  const groups = useMemo(() => buildGroups(suggest), [suggest]);
  const tokens = useMemo(() => tokenize(localQuery), [localQuery]);
  const rows = useMemo(() => buildVirtualRows(groups), [groups]);
  const trimmedQuery = localQuery.trim();
  const canShowAskAiChip = trimmedQuery.length >= ASK_AI_MIN_QUERY_LENGTH;

  useEffect(() => {
    setLocalQuery(query);
  }, [query, open]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setActiveGroupIndex(0);
      setActiveItemIndex(0);
      setLocalQuery(query);
      setIsComposing(false);
      if (onClose) {
        onClose();
      }
    }
  }, [open, onClose, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const now = performance.now();
    if (now - lastInputTime < SEARCH_DEBOUNCE_MS) {
      const timeout = window.setTimeout(() => {
        if (!isComposing) {
          onQueryChange(localQuery);
        }
      }, SEARCH_DEBOUNCE_MS - (now - lastInputTime));
      return () => window.clearTimeout(timeout);
    }

    if (!isComposing) {
      onQueryChange(localQuery);
    }
  }, [localQuery, onQueryChange, isComposing, open, lastInputTime]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index: number) => {
      const row = rows[index];
      if (row.type === "group") {
        return 32;
      }
      if (row.type === "more") {
        return 40;
      }
      return 72;
    },
    getScrollElement: () => scrollParentRef.current,
    overscan: 4,
  });

  const activeOptionId = groups[activeGroupIndex]?.items[activeItemIndex]
    ? getOptionId(activeGroupIndex, activeItemIndex)
    : undefined;
  const virtualItems = virtualizer.getVirtualItems();

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
  };

  const handleAskAi = async () => {
    if (!isAskAiEnabled || localQuery.trim().length < ASK_AI_MIN_QUERY_LENGTH) {
      return;
    }

    await onAskAi(localQuery.trim());
    if (closeOnAsk) {
      setOpen(false);
    }
  };

  const moveSelection = (direction: 1 | -1) => {
    if (groups.length === 0) {
      return;
    }

    let groupIndex = activeGroupIndex;
    let itemIndex = activeItemIndex + direction;

    while (groupIndex >= 0 && groupIndex < groups.length) {
      const group = groups[groupIndex];
      if (itemIndex >= 0 && itemIndex < group.items.length) {
        setActiveGroupIndex(groupIndex);
        setActiveItemIndex(itemIndex);
        const targetIndex = rows.findIndex(
          (row) => row.type === "item" && row.groupIndex === groupIndex && row.itemIndex === itemIndex,
        );
        if (targetIndex >= 0) {
          virtualizer.scrollToIndex(targetIndex, { align: "auto" });
        }
        return;
      }

      groupIndex += direction;
      itemIndex = direction === 1 ? 0 : Math.max(0, (groups[groupIndex]?.items.length ?? 1) - 1);
    }
  };

  const moveGroup = (direction: 1 | -1) => {
    if (groups.length === 0) {
      return;
    }

    let nextGroup = activeGroupIndex + direction;
    if (nextGroup < 0) {
      nextGroup = groups.length - 1;
    } else if (nextGroup >= groups.length) {
      nextGroup = 0;
    }

    setActiveGroupIndex(nextGroup);
    setActiveItemIndex(0);
    const targetIndex = rows.findIndex((row) => row.type === "group" && row.groupIndex === nextGroup);
    if (targetIndex >= 0) {
      virtualizer.scrollToIndex(targetIndex, { align: "start" });
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleAskAi();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      moveGroup(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveGroupIndex(0);
      setActiveItemIndex(0);
      virtualizer.scrollToIndex(0, { align: "start" });
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const lastGroupIndex = groups.length - 1;
      const lastItemIndex = Math.max(0, groups[lastGroupIndex]?.items.length - 1);
      setActiveGroupIndex(lastGroupIndex);
      setActiveItemIndex(lastItemIndex);
      const lastRowIndex = rows.length - 1;
      virtualizer.scrollToIndex(lastRowIndex, { align: "end" });
      return;
    }

    if (event.key === "PageDown") {
      event.preventDefault();
      moveSelection(1);
      moveSelection(1);
      moveSelection(1);
      moveSelection(1);
      return;
    }

    if (event.key === "PageUp") {
      event.preventDefault();
      moveSelection(-1);
      moveSelection(-1);
      moveSelection(-1);
      moveSelection(-1);
    }
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      moveGroup(event.shiftKey ? -1 : 1);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleAskAi();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const group = groups[activeGroupIndex];
      const item = group?.items[activeItemIndex];
      if (item) {
        onResultOpen(item, { newTab: event.shiftKey });
        setOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const renderRow = (row: VirtualRow) => {
    if (row.type === "group") {
      const group = groups[row.groupIndex];
      return (
        <div
          className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          role="group"
        >
          <span className="block truncate" title={group.title}>
            {truncateEnd(group.title, 56)}
          </span>
        </div>
      );
    }

    if (row.type === "more") {
      return (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          Показать ещё в этой группе
        </div>
      );
    }

    const group = groups[row.groupIndex];
    const item = group.items[row.itemIndex];
    const isActive = row.groupIndex === activeGroupIndex && row.itemIndex === activeItemIndex;

    const breadcrumbs = buildBreadcrumbs(item);
    const displayTitle = getDisplayTitle(item);
    const truncatedTitle = truncateMiddle(displayTitle, 80);
    const highlightedTitle = highlightText(truncatedTitle, tokens);
    const breadcrumbText = truncateEnd(breadcrumbs, 96);
    const highlightedBreadcrumbs = highlightText(breadcrumbText, tokens);
    const metaChips = buildMetaChips(item);

    const hasSnippet = Boolean(item.snippet_html?.trim());
    const hasBreadcrumbs = Boolean(breadcrumbs);

    return (
      <div
        id={getOptionId(row.groupIndex, row.itemIndex)}
        role="option"
        aria-selected={isActive}
        tabIndex={-1}
        className={cn(
          "flex cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-sm transition-colors",
          isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
        )}
        onMouseEnter={() => {
          setActiveGroupIndex(row.groupIndex);
          setActiveItemIndex(row.itemIndex);
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onResultOpen(item);
          setOpen(false);
        }}
        >
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-1 font-semibold leading-tight" title={displayTitle}>
            {highlightedTitle}
          </span>
          <span className="mt-0.5 text-[11px] text-muted-foreground">↵</span>
        </div>
        {(hasBreadcrumbs || metaChips) && (
          <div className="flex items-start gap-2 text-[13px] leading-tight text-muted-foreground">
            {hasBreadcrumbs ? (
              <span className="line-clamp-1 flex-1" title={breadcrumbs}>
                {highlightedBreadcrumbs}
              </span>
            ) : (
              <span className="flex-1" />
            )}
            {metaChips}
          </div>
        )}
        {hasSnippet && (
          <div
            className="line-clamp-2 text-xs leading-snug text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: item.snippet_html }}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <Button
        variant="outline"
        className="h-9 gap-2 px-3 text-sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Search className="h-4 w-4" />
        <span>Поиск (⌘K)</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-xl border p-0"
          aria-label="Поиск по документации"
        >
          <div
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-owns="search-quick-switcher-list"
            className="flex flex-col"
          >
            <div className="flex items-center gap-2 border-b bg-card px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={localQuery}
                autoFocus
                placeholder="Поиск…"
                onChange={(event) => {
                  setLastInputTime(performance.now());
                  setLocalQuery(event.target.value);
                }}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(event) => {
                  setIsComposing(false);
                  setLocalQuery(event.currentTarget.value);
                }}
                onFocus={() => {
                  if (onPrefetch) {
                    onPrefetch(localQuery);
                  }
                }}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-autocomplete="list"
                aria-controls="search-quick-switcher-list"
                aria-activedescendant={activeOptionId}
              />
              {localQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setLocalQuery("");
                    onQueryChange("");
                  }}
                >
                  Очистить
                </Button>
              )}
            </div>

            {canShowAskAiChip && (
              <div className="border-b px-4 py-2">
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    isAskAiEnabled
                      ? "border-primary/40 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      : "cursor-not-allowed border-muted text-muted-foreground",
                  )}
                  onClick={() => void handleAskAi()}
                  disabled={!isAskAiEnabled || !canShowAskAiChip}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="max-w-[200px] truncate">Ask AI: {trimmedQuery}</span>
                  <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘↵</kbd>
                </button>
              </div>
            )}

            <div className="flex flex-1 flex-col">
              <div
                ref={scrollParentRef}
                className="max-h-[420px] flex-1 overflow-y-auto"
              >
                <div
                  id="search-quick-switcher-list"
                  role="listbox"
                  aria-label="Результаты поиска"
                  aria-live="polite"
                  tabIndex={-1}
                  onKeyDown={handleListKeyDown}
                  className="flex flex-col gap-1 px-2 py-2"
                >
                  {status === "loading" && (
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <div key={index} className="animate-pulse rounded-md border border-dashed px-3 py-4">
                          <div className="h-3 w-32 rounded bg-muted" />
                          <div className="mt-2 h-3 w-full rounded bg-muted" />
                        </div>
                      ))}
                    </div>
                  )}

                  {status === "error" && error && (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/60 bg-destructive/10 px-4 py-6 text-sm text-destructive">
                      <span>Ошибка: {error}</span>
                      <Button variant="outline" size="sm" onClick={() => onQueryChange(localQuery)}>
                        Повторить
                      </Button>
                    </div>
                  )}

                  {status !== "loading" && !error && groups.length === 0 && localQuery.trim() && (
                    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                      <Search className="h-6 w-6 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">Ничего не найдено.</p>
                        <p>Попробуйте другие ключевые слова или сузьте запрос.</p>
                      </div>
                      {isAskAiEnabled && (
                        <Button onClick={() => void handleAskAi()} disabled={localQuery.trim().length < ASK_AI_MIN_QUERY_LENGTH}>
                          Спросить AI
                        </Button>
                      )}
                    </div>
                  )}

                  {groups.length > 0 && (
                    <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                      {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => (
                        <div
                          key={virtualRow.key}
                          data-index={virtualRow.index}
                          className="absolute left-0 right-0"
                          style={{
                            top: 0,
                            transform: `translateY(${virtualRow.start}px)`,
                            height: `${virtualRow.size}px`,
                          }}
                        >
                          {renderRow(rows[virtualRow.index])}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  {STATUS_BAR_SHORTCUTS.map((shortcut) => (
                    <span key={shortcut.label} className="inline-flex items-center gap-1">
                      <span className="font-medium text-foreground">{shortcut.value}</span>
                      <span>{shortcut.label}</span>
                    </span>
                  ))}
                </div>
                {disabledReason && <span className="text-destructive">{disabledReason}</span>}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SearchQuickSwitcher;

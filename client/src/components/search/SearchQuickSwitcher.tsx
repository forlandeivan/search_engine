import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { ArrowLeft, CircleStop, LoaderCircle, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  RagChunk,
  SuggestResponseItem,
  SuggestResponsePayload,
  SuggestResponseSection,
} from "@/types/search";

const GROUP_ITEM_LIMIT = 5;
const ASK_AI_MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 150;
const ASK_AI_OPTION_ID = "search-option-ask";

interface SearchQuickSwitcherProps {
  query: string;
  isAskAiEnabled: boolean;
  suggest: SuggestResponsePayload | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  onQueryChange: (value: string) => void;
  onAskAi: (query: string) => Promise<void> | void;
  askState?: {
    isActive: boolean;
    question: string;
    answerHtml: string;
    statusMessage: string | null;
    showIndicator: boolean;
    error: string | null;
    sources: RagChunk[];
    isStreaming: boolean;
    isDone: boolean;
  };
  onAskAiStop?: () => void;
  onResultOpen?: (section: SuggestResponseItem, options?: { newTab?: boolean }) => void;
  onClose?: () => void;
  onPrefetch?: (query: string) => void;
  closeOnAsk?: boolean;
  disabledReason?: string | null;
  renderTrigger?: (options: { open: () => void; isOpen: boolean }) => ReactNode;
}

export interface SuggestResultGroup {
  id: string;
  title: string;
  items: SuggestResponseItem[];
  hasMore: boolean;
}

type VirtualRow =
  | { type: "ask" }
  | { type: "group"; groupIndex: number }
  | { type: "item"; groupIndex: number; itemIndex: number }
  | { type: "more"; groupIndex: number };

const STATUS_BAR_SHORTCUTS = [
  { label: "Навигация", value: "↑/↓" },
  { label: "Группы", value: "Tab" },
  { label: "Новая вкладка", value: "⇧↵" },
  { label: "Ask AI", value: "↵" },
  { label: "Закрыть", value: "Esc" },
];

const noop = () => {};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resolveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function sanitizeSuggestItem(item: SuggestResponseItem, fallbackId: string): SuggestResponseItem {
  const trimmedUrl = normalizeString(item.url);
  const trimmedTitle = normalizeString(item.title);

  return {
    ...item,
    id: item.id || fallbackId,
    url: trimmedUrl || (typeof item.url === "string" ? item.url : undefined),
    title: trimmedTitle || item.title || fallbackId,
    breadcrumbs: Array.isArray(item.breadcrumbs) ? item.breadcrumbs : [],
    snippet_html: typeof item.snippet_html === "string" ? item.snippet_html : "",
  };
}

function resolveSnippetHtml(section: SuggestResponseSection): string {
  const directHtml = normalizeString(section.snippet_html);
  if (directHtml) {
    return directHtml;
  }

  const snippet = normalizeString(section.snippet) || normalizeString(section.text);
  if (!snippet) {
    return "";
  }

  return escapeHtml(snippet);
}

function mapSectionToItem(section: SuggestResponseSection, index: number): SuggestResponseItem | null {
  const chunkId = normalizeString(section.chunk_id);
  const docId = normalizeString(section.doc_id);
  const docTitle = normalizeString(section.doc_title);
  const sectionTitle = normalizeString(section.section_title);
  const url = normalizeString(section.url);
  const breadcrumbs = Array.isArray(section.breadcrumbs)
    ? section.breadcrumbs.map(normalizeString).filter(Boolean)
    : [];
  const score = resolveNumber(section.score);

  const baseId = chunkId || `${docId || "doc"}-${index + 1}`;
  const displayDocTitle = docTitle || sectionTitle || `Документ ${index + 1}`;
  const computedBreadcrumbs = breadcrumbs.length > 0 ? breadcrumbs : [];
  const typeLabel = (() => {
    const source = normalizeString(section.source);
    if (!source) {
      return null;
    }
    if (source === "sections") {
      return "Структура";
    }
    if (source === "content") {
      return null;
    }
    return source;
  })();

  return {
    id: baseId,
    url: url || undefined,
    title: displayDocTitle,
    heading_text: sectionTitle || null,
    breadcrumbs: computedBreadcrumbs,
    snippet_html: resolveSnippetHtml(section),
    type: typeLabel ?? undefined,
    score,
    docId: docId || null,
    chunkId: chunkId || null,
    anchor: null,
  } satisfies SuggestResponseItem;
}

function buildLegacyGroups(payload: SuggestResponsePayload | null): SuggestResultGroup[] {
  if (!payload || !Array.isArray(payload.groups) || payload.groups.length === 0) {
    return [];
  }

  return payload.groups.map((group, index) => ({
    id: normalizeString(group.id) || `group-${index + 1}`,
    title: normalizeString(group.title) || group.id,
    hasMore: Boolean(group.hasMore && group.items.length > GROUP_ITEM_LIMIT),
    items: group.items.slice(0, GROUP_ITEM_LIMIT).map((item, itemIndex) =>
      sanitizeSuggestItem(item, `${group.id}-${itemIndex}`),
    ),
  }));
}

function buildSectionGroups(payload: SuggestResponsePayload | null): SuggestResultGroup[] {
  const sections = payload?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return [];
  }

  const groups: Array<{ id: string; title: string; items: SuggestResponseItem[] }> = [];
  const groupIndexByKey = new Map<string, number>();

  sections.forEach((section, index) => {
    const item = mapSectionToItem(section, index);
    if (!item) {
      return;
    }

    const docId = normalizeString(section.doc_id);
    const docTitle = normalizeString(section.doc_title) || item.title || `Документ ${index + 1}`;
    const groupKey = docId || docTitle || `section-${index + 1}`;
    const existingIndex = groupIndexByKey.get(groupKey);

    if (existingIndex === undefined) {
      const groupId = docId || `knowledge-doc-${groups.length + 1}`;
      groups.push({
        id: groupId,
        title: docTitle || "Фрагменты базы знаний",
        items: [item],
      });
      groupIndexByKey.set(groupKey, groups.length - 1);
    } else {
      groups[existingIndex].items.push(item);
    }
  });

  return groups.map((group, index) => ({
    id: group.id || `knowledge-doc-${index + 1}`,
    title: group.title || "Фрагменты базы знаний",
    items: group.items.slice(0, GROUP_ITEM_LIMIT),
    hasMore: group.items.length > GROUP_ITEM_LIMIT,
  }));
}

export function buildSuggestGroups(payload: SuggestResponsePayload | null): SuggestResultGroup[] {
  const legacyGroups = buildLegacyGroups(payload);
  if (legacyGroups.length > 0) {
    return legacyGroups;
  }

  return buildSectionGroups(payload);
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

function getPlainSnippet(item: SuggestResponseItem) {
  const snippetHtml = normalizeString(item.snippet_html);
  if (!snippetHtml) {
    return "";
  }

  if (typeof window !== "undefined") {
    const container = window.document.createElement("div");
    container.innerHTML = snippetHtml;
    const text = container.textContent || container.innerText || "";
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  return snippetHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildVirtualRows(groups: SuggestResultGroup[]): VirtualRow[] {
  const rows: VirtualRow[] = [];

  groups.forEach((group, groupIndex) => {
    rows.push({ type: "group", groupIndex });
    for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
      rows.push({ type: "item", groupIndex, itemIndex });
    }
    if (group.hasMore) {
      rows.push({ type: "more", groupIndex });
    }
  });

  return rows;
}

function getOptionId(groupIndex: number, itemIndex: number) {
  return `search-option-${groupIndex}-${itemIndex}`;
}

function isInteractiveRow(row: VirtualRow | undefined):
  | ({ type: "ask" }
      | { type: "item"; groupIndex: number; itemIndex: number })
  | false {
  if (!row) {
    return false;
  }

  if (row.type === "ask") {
    return row;
  }

  if (row.type === "item") {
    return row;
  }

  return false;
}

export function SearchQuickSwitcher({
  query,
  suggest,
  status,
  error,
  onQueryChange,
  onAskAi,
  askState,
  onAskAiStop,
  onResultOpen = noop,
  onClose,
  onPrefetch,
  isAskAiEnabled,
  closeOnAsk = true,
  disabledReason,
  renderTrigger,
}: SearchQuickSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "ask">("search");
  const [isComposing, setIsComposing] = useState(false);
  const [activeRowIndex, setActiveRowIndex] = useState(-1);
  const [localQuery, setLocalQuery] = useState(query);
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const [lastInputTime, setLastInputTime] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollPositionRef = useRef(0);

  const groups = useMemo(() => buildSuggestGroups(suggest), [suggest]);
  const tokens = useMemo(() => tokenize(localQuery), [localQuery]);
  const normalizedQuery = localQuery.trim();
  const canSubmitAskAi = normalizedQuery.length >= ASK_AI_MIN_QUERY_LENGTH;
  const shouldRenderAskAiRow = normalizedQuery.length > 0;
  const rows = useMemo(() => {
    const baseRows = buildVirtualRows(groups);
    if (!shouldRenderAskAiRow) {
      return baseRows;
    }
    return ([{ type: "ask" }] as VirtualRow[]).concat(baseRows);
  }, [groups, shouldRenderAskAiRow]);

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
      setLocalQuery(query);
      setIsComposing(false);
      setActiveRowIndex(-1);
      if (onClose) {
        onClose();
      }
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, onClose, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const firstInteractiveIndex = rows.findIndex((row) => Boolean(isInteractiveRow(row)));
    if (firstInteractiveIndex === -1) {
      setActiveRowIndex(-1);
      return;
    }

    const lastInteractiveIndex = (() => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (isInteractiveRow(rows[index])) {
          return index;
        }
      }
      return firstInteractiveIndex;
    })();

    if (activeRowIndex === -1) {
      setActiveRowIndex(firstInteractiveIndex);
      return;
    }

    if (activeRowIndex > lastInteractiveIndex) {
      setActiveRowIndex(lastInteractiveIndex);
      return;
    }

    const currentRow = rows[activeRowIndex];
    if (!isInteractiveRow(currentRow)) {
      setActiveRowIndex(firstInteractiveIndex);
    }
  }, [rows, open, activeRowIndex]);

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
      if (row.type === "ask") {
        return 56;
      }
      if (row.type === "group") {
        return 36;
      }
      if (row.type === "more") {
        return 40;
      }
      return 68;
    },
    getScrollElement: () => scrollParentRef.current,
    overscan: 4,
  });

  const activeRow = activeRowIndex >= 0 ? rows[activeRowIndex] : undefined;
  const activeOptionId = (() => {
    if (!activeRow) {
      return undefined;
    }
    if (activeRow.type === "ask") {
      return ASK_AI_OPTION_ID;
    }
    if (activeRow.type === "item") {
      return getOptionId(activeRow.groupIndex, activeRow.itemIndex);
    }
    return undefined;
  })();
  const virtualItems = virtualizer.getVirtualItems();

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setActiveTab("search");
      setActiveRowIndex(-1);
      if (scrollParentRef.current) {
        scrollParentRef.current.scrollTop = 0;
      }
    }
  };

  const handleAskAi = async () => {
    if (!isAskAiEnabled || !canSubmitAskAi) {
      return;
    }

    if (scrollParentRef.current) {
      scrollPositionRef.current = scrollParentRef.current.scrollTop;
    }
    setActiveTab("ask");

    try {
      await onAskAi(normalizedQuery);
      if (closeOnAsk) {
        setOpen(false);
      }
    } catch (error) {
      console.error("Не удалось выполнить запрос Ask AI", error);
    }
  };

  const handleBackToSearch = () => {
    setActiveTab("search");
    requestAnimationFrame(() => {
      if (scrollParentRef.current) {
        scrollParentRef.current.scrollTop = scrollPositionRef.current;
      }
    });
  };

  const scrollToRow = (index: number, align: "auto" | "start" | "center" | "end" = "auto") => {
    if (index < 0) {
      return;
    }

    virtualizer.scrollToIndex(index, { align });
  };

  const moveSelection = (direction: 1 | -1) => {
    if (rows.length === 0) {
      return;
    }

    let startIndex = activeRowIndex;
    if (startIndex === -1) {
      startIndex = direction === 1 ? -1 : rows.length;
    }

    let nextIndex = startIndex + direction;
    while (nextIndex >= 0 && nextIndex < rows.length) {
      if (isInteractiveRow(rows[nextIndex])) {
        setActiveRowIndex(nextIndex);
        scrollToRow(nextIndex);
        return;
      }
      nextIndex += direction;
    }
  };

  const moveGroup = (direction: 1 | -1) => {
    if (groups.length === 0) {
      return;
    }

    const currentInteractive = isInteractiveRow(activeRow);
    let currentGroupIndex =
      currentInteractive && currentInteractive.type === "item"
        ? currentInteractive.groupIndex
        : direction === 1
          ? -1
          : groups.length;

    for (let attempt = 0; attempt < groups.length; attempt += 1) {
      currentGroupIndex += direction;
      if (currentGroupIndex < 0) {
        currentGroupIndex = groups.length - 1;
      } else if (currentGroupIndex >= groups.length) {
        currentGroupIndex = 0;
      }

      const targetIndex = rows.findIndex(
        (row) => row.type === "item" && row.groupIndex === currentGroupIndex,
      );
      if (targetIndex !== -1) {
        setActiveRowIndex(targetIndex);
        scrollToRow(targetIndex, "start");
        return;
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      moveGroup(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeRow?.type === "item") {
        const group = groups[activeRow.groupIndex];
        const item = group?.items[activeRow.itemIndex];
        if (item) {
          onResultOpen(item, { newTab: event.shiftKey });
          setOpen(false);
          return;
        }
      }

      void handleAskAi();
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
      const firstInteractiveIndex = rows.findIndex((row) => Boolean(isInteractiveRow(row)));
      if (firstInteractiveIndex !== -1) {
        setActiveRowIndex(firstInteractiveIndex);
        scrollToRow(firstInteractiveIndex, "start");
      }
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (isInteractiveRow(rows[index])) {
          setActiveRowIndex(index);
          scrollToRow(index, "end");
          break;
        }
      }
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

    if (event.key === "Enter") {
      event.preventDefault();
      if (activeRow?.type === "ask") {
        void handleAskAi();
        return;
      }

      if (activeRow?.type === "item") {
        const group = groups[activeRow.groupIndex];
        const item = group?.items[activeRow.itemIndex];
        if (item) {
          onResultOpen(item, { newTab: event.shiftKey });
          setOpen(false);
        }
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const renderRow = (row: VirtualRow, rowIndex: number) => {
    if (row.type === "ask") {
      const isActive = rowIndex === activeRowIndex;
      const isDisabled = !isAskAiEnabled || !canSubmitAskAi;
      return (
        <div
          id={ASK_AI_OPTION_ID}
          role="option"
          aria-selected={isActive}
          aria-disabled={isDisabled}
          tabIndex={-1}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
            isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            isDisabled ? "cursor-not-allowed opacity-70 hover:bg-transparent" : "",
          )}
          onMouseEnter={() => setActiveRowIndex(rowIndex)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!isDisabled) {
              void handleAskAi();
            }
          }}
        >
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold" title={normalizedQuery}>
              Ask AI: {normalizedQuery}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              Мгновенный ответ по базе знаний
            </span>
          </div>
          <kbd className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">↵</kbd>
        </div>
      );
    }

    if (row.type === "group") {
      const group = groups[row.groupIndex];
      return (
        <div
          className={cn(
            "border-t border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
            rowIndex === 0 ? "border-t-transparent" : undefined,
          )}
          role="presentation"
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
    const isActive = rowIndex === activeRowIndex;

    const displayTitle = getDisplayTitle(item);
    const truncatedTitle = truncateMiddle(displayTitle, 80);
    const highlightedTitle = highlightText(truncatedTitle, tokens);
    const snippetText = getPlainSnippet(item);
    const truncatedSnippet = truncateEnd(snippetText, 140);
    const highlightedSnippet = highlightText(truncatedSnippet, tokens);

    return (
      <div
        id={getOptionId(row.groupIndex, row.itemIndex)}
        role="option"
        aria-selected={isActive}
        tabIndex={-1}
        className={cn(
          "flex cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "hover:bg-muted",
        )}
        onMouseEnter={() => setActiveRowIndex(rowIndex)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onResultOpen(item);
          setOpen(false);
        }}
      >
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold" title={displayTitle}>
            {highlightedTitle}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">↵</span>
        </div>
        {snippetText && (
          <div className="truncate text-xs text-muted-foreground" title={snippetText}>
            {highlightedSnippet}
          </div>
        )}
      </div>
    );
  };

  const triggerNode = renderTrigger
    ? renderTrigger({
        open: () => setOpen(true),
        isOpen: open,
      })
    : (
        <Button
          variant="outline"
          className="h-9 gap-2 px-3 text-sm"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <Search className="h-4 w-4" />
          <span>Поиск (⌘K)</span>
        </Button>
      );

  return (
    <>
      {triggerNode}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="top-0 flex h-screen w-[min(720px,100vw)] max-h-screen max-w-[720px] translate-y-0 flex-col overflow-hidden rounded-none border border-border/60 bg-background p-0 sm:left-1/2 sm:translate-x-[-50%]"
          aria-label="Поиск по документации"
        >
          <div
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-owns="search-quick-switcher-list"
            className="flex h-full flex-col"
          >
            {activeTab === "search" ? (
              <div className="flex items-center gap-2 border-b bg-card px-4 py-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={localQuery}
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
            ) : (
              <div className="flex items-center justify-between border-b bg-card px-4 py-3">
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={handleBackToSearch}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Задать другой вопрос…</span>
                </button>
                {askState?.isStreaming && onAskAiStop && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 px-3 text-xs"
                    onClick={() => onAskAiStop()}
                  >
                    <CircleStop className="h-4 w-4" />
                    Stop
                  </Button>
                )}
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                ref={scrollParentRef}
                className={cn(
                  "flex-1 overflow-y-auto px-3 py-3",
                  activeTab === "ask" && "hidden",
                )}
              >
                <div
                  id="search-quick-switcher-list"
                  role="listbox"
                  aria-label="Результаты поиска"
                  aria-live="polite"
                  aria-busy={status === "loading"}
                  tabIndex={-1}
                  onKeyDown={handleListKeyDown}
                  className="flex flex-col gap-2"
                >
                  {status === "loading" && groups.length > 0 && (
                    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                      <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                      <span>Ищем подсказки…</span>
                    </div>
                  )}

                  {rows.length > 0 && (
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
                          {renderRow(rows[virtualRow.index], virtualRow.index)}
                        </div>
                      ))}
                    </div>
                  )}

                  {status === "loading" && groups.length === 0 && (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-md border border-dashed px-4 text-sm text-muted-foreground">
                      <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                      <span>Ищем подсказки…</span>
                    </div>
                  )}

                  {status === "idle" && groups.length === 0 && !normalizedQuery && (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
                      <Search className="h-6 w-6 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">Начните поиск.</p>
                        <p>Введите запрос, чтобы увидеть подсказки.</p>
                      </div>
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

                  {status !== "loading" && !error && groups.length === 0 && normalizedQuery && (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
                      <Search className="h-6 w-6 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">Ничего не найдено.</p>
                        <p>Попробуйте изменить формулировку запроса.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  "flex-1 overflow-y-auto px-4 py-4",
                  activeTab === "search" && "hidden",
                )}
                aria-live="polite"
              >
                <div className="space-y-3">
                  <div className="rounded border px-3 py-2 text-sm">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Вопрос</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {askState?.question || normalizedQuery || "—"}
                    </div>
                  </div>
                  {askState?.showIndicator && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                      <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                      <span>{askState.statusMessage ?? "Готовим ответ…"}</span>
                    </div>
                  )}
                  {askState?.error && (
                    <div
                      role="alert"
                      className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {askState.error}
                    </div>
                  )}
                  <div
                    className="rounded border px-3 py-3 text-sm leading-relaxed text-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {askState?.answerHtml ? (
                      <div
                        className="prose prose-sm max-w-none text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5"
                        dangerouslySetInnerHTML={{ __html: askState.answerHtml }}
                      />
                    ) : askState?.isStreaming ? (
                      <span className="text-muted-foreground">Готовим ответ…</span>
                    ) : (
                      <span className="text-muted-foreground">
                        Введите вопрос, чтобы Ask AI подготовил ответ.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="shrink-0 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center justify-between gap-3">
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

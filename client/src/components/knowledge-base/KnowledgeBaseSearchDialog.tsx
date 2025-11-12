import { useCallback, useEffect, useMemo, useState } from "react";

import { Loader2, Search as SearchIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSuggestSearch } from "@/hooks/useSuggestSearch";
import { cn } from "@/lib/utils";
import type { SuggestResponseItem, SuggestResponsePayload, SuggestResponseSection } from "@/types/search";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";

const SEARCH_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 200;

export type KnowledgeBaseSearchDialogOptions = {
  topK?: number | null;
  bm25Weight?: number | null;
  vectorWeight?: number | null;
  embeddingProviderId?: string | null;
  embeddingProviderName?: string | null;
  collection?: string | null;
};

export interface KnowledgeBaseSearchResult {
  id: string;
  title: string;
  snippetHtml: string;
  breadcrumbs: string[];
  url?: string;
  docId?: string | null;
  chunkId?: string | null;
  score?: number | null;
  type?: string | null;
}

interface KnowledgeBaseSearchDialogProps {
  base: KnowledgeBaseSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectResult?: (result: KnowledgeBaseSearchResult) => void;
  searchOptions?: KnowledgeBaseSearchDialogOptions | null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveSnippetHtml(section: SuggestResponseSection): string {
  const direct = normalizeString(section.snippet_html);
  if (direct) {
    return direct;
  }

  const fallback = normalizeString(section.snippet) || normalizeString(section.text);
  return fallback ? fallback.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
}

function mapSectionToResult(section: SuggestResponseSection, index: number): KnowledgeBaseSearchResult | null {
  const chunkId = normalizeString(section.chunk_id);
  const docId = normalizeString(section.doc_id);
  const docTitle = normalizeString(section.doc_title);
  const sectionTitle = normalizeString(section.section_title);
  const url = normalizeString(section.url);
  const breadcrumbs = Array.isArray(section.breadcrumbs)
    ? section.breadcrumbs.map(normalizeString).filter(Boolean)
    : [];
  const sourceLabel = normalizeString(section.source);
  const baseId = chunkId || docId || `section-${index + 1}`;
  const title = docTitle || sectionTitle || `Документ ${index + 1}`;

  return {
    id: baseId,
    title,
    breadcrumbs,
    snippetHtml: resolveSnippetHtml(section),
    url: url || undefined,
    docId: docId || null,
    chunkId: chunkId || null,
    score: typeof section.score === "number" ? section.score : null,
    type: sourceLabel || undefined,
  };
}

function sanitizeItem(item: SuggestResponseItem, index: number): KnowledgeBaseSearchResult {
  const breadcrumbs = Array.isArray(item.breadcrumbs)
    ? item.breadcrumbs.map(normalizeString).filter(Boolean)
    : [];

  return {
    id: item.id || `item-${index + 1}`,
    title: normalizeString(item.title) || `Документ ${index + 1}`,
    breadcrumbs,
    snippetHtml: normalizeString(item.snippet_html),
    url: normalizeString(item.url) || undefined,
    docId: item.docId ?? null,
    chunkId: item.chunkId ?? null,
    score: item.score ?? null,
    type: item.type ?? null,
  };
}

function buildResults(payload: SuggestResponsePayload | null): KnowledgeBaseSearchResult[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.sections) && payload.sections.length > 0) {
    return payload.sections
      .map((section, index) => mapSectionToResult(section, index))
      .filter((value): value is KnowledgeBaseSearchResult => Boolean(value));
  }

  if (Array.isArray(payload.groups) && payload.groups.length > 0) {
    return payload.groups.flatMap((group) =>
      group.items.map((item, index) => sanitizeItem(item, index)),
    );
  }

  return [];
}

const clampTopK = (value: number | null | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return SEARCH_LIMIT;
  }

  const rounded = Math.round(value);
  return Math.max(1, Math.min(10, rounded));
};

export function KnowledgeBaseSearchDialog({
  base,
  open,
  onOpenChange,
  onSelectResult,
  searchOptions,
}: KnowledgeBaseSearchDialogProps) {
  const [query, setQuery] = useState("");
  const limit = useMemo(() => clampTopK(searchOptions?.topK), [searchOptions?.topK]);
  const { data, error, status, search, reset } = useSuggestSearch({
    knowledgeBaseId: base?.id ?? "",
    limit,
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    const handle = window.setTimeout(() => {
      search(trimmed);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [open, query, search]);

  const results = useMemo(() => buildResults(data), [data]);

  const configSummary = useMemo(() => {
    const parts: string[] = [];
    if (limit) {
      parts.push(`Top-K: ${limit}`);
    }

    const bm25Weight = searchOptions?.bm25Weight;
    if (typeof bm25Weight === "number" && Number.isFinite(bm25Weight)) {
      parts.push(`BM25 вес: ${bm25Weight}`);
    }

    const vectorWeight = searchOptions?.vectorWeight;
    if (typeof vectorWeight === "number" && Number.isFinite(vectorWeight)) {
      parts.push(`Вектор вес: ${vectorWeight}`);
    }

    if (searchOptions?.collection) {
      parts.push(`Коллекция: ${searchOptions.collection}`);
    }

    if (searchOptions?.embeddingProviderName) {
      parts.push(`Провайдер: ${searchOptions.embeddingProviderName}`);
    } else if (searchOptions?.embeddingProviderId) {
      parts.push(`Провайдер: ${searchOptions.embeddingProviderId}`);
    }

    return parts.length > 0 ? parts.join(" · ") : null;
  }, [limit, searchOptions?.bm25Weight, searchOptions?.collection, searchOptions?.embeddingProviderId, searchOptions?.embeddingProviderName, searchOptions?.vectorWeight]);

  const infoLines = useMemo(() => {
    const lines: string[] = [];

    if (base) {
      lines.push(`Поиск выполняется в базе «${base.name}». Диалог использует локальные параметры страницы.`);
    } else {
      lines.push("Выберите базу знаний на странице, чтобы выполнить поиск и применить локальные параметры.");
    }

    if (configSummary) {
      lines.push(configSummary);
    }

    return lines;
  }, [base, configSummary]);

  const handleSelect = useCallback(
    (result: KnowledgeBaseSearchResult) => {
      onSelectResult?.(result);
      onOpenChange(false);
    },
    [onOpenChange, onSelectResult],
  );

  const listContent = (() => {
    if (!base) {
      return (
        <CommandEmpty>
          Выберите базу знаний в основной панели — диалог поиска работает в контексте выбранной базы.
        </CommandEmpty>
      );
    }

    if (!query.trim()) {
      return (
        <CommandEmpty>
          Введите запрос — поиск выполнится внутри базы «{base.name}» с учётом локальных настроек.
        </CommandEmpty>
      );
    }

    if (status === "loading") {
      return (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ищем подсказки...
        </div>
      );
    }

    if (status === "error") {
      return (
        <div className="px-3 py-6 text-sm text-destructive">
          {error || "Не удалось получить результаты поиска."}
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <CommandEmpty>
          Ничего не найдено для запроса «{query.trim()}». Попробуйте скорректировать параметры поиска на странице базы знаний.
        </CommandEmpty>
      );
    }

    return (
      <ScrollArea className="max-h-[400px]">
        <CommandGroup heading={`Результаты (${results.length})`}>
          {results.map((result) => (
            <CommandItem
              key={result.id}
              value={result.title}
              onSelect={() => handleSelect(result)}
              className="items-start gap-2"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                <SearchIcon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-none">{result.title}</span>
                  {typeof result.score === "number" && (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {result.score.toFixed(2)}
                    </Badge>
                  )}
                  {result.type && (
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {result.type}
                    </Badge>
                  )}
                </div>
                {result.breadcrumbs.length > 0 && (
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {result.breadcrumbs.join(" › ")}
                  </p>
                )}
                {result.snippetHtml && (
                  <p
                    className={cn("line-clamp-2 text-xs text-muted-foreground", "[&_mark]:rounded [&_mark]:bg-primary/10 [&_mark]:p-0.5")}
                    dangerouslySetInnerHTML={{ __html: result.snippetHtml }}
                  />
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </ScrollArea>
    );
  })();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={base ? `Поиск по базе «${base.name}»...` : "Сначала выберите базу знаний"}
        autoFocus
      />
      {infoLines.length > 0 && (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          <div className="space-y-1">
            {infoLines.map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      )}
      <CommandList>{listContent}</CommandList>
    </CommandDialog>
  );
}


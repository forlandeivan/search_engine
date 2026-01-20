import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, ExternalLink, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useToast } from "@/hooks/use-toast";
import type { RagChunk } from "@/types/search";
import { SourcePreviewCard } from "./SourcePreviewCard";
import { GroupedCitationCard } from "./GroupedCitationCard";
import { groupCitationsByDocument, getSourcesSummary } from "./citationUtils";

type ChatCitationsProps = {
  citations: RagChunk[];
  workspaceId?: string;
  className?: string;
  enableGrouping?: boolean; // Флаг для включения группировки
};

export function ChatCitations({ 
  citations, 
  workspaceId, 
  className,
  enableGrouping = true,
}: ChatCitationsProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!citations || citations.length === 0) {
    return null;
  }

  const groups = enableGrouping 
    ? groupCitationsByDocument(citations)
    : null;
  
  const summary = groups 
    ? getSourcesSummary(groups)
    : `${citations.length} источников`;

  return (
    <div className={cn("mt-3 border-t pt-3", className)}>
      {/* Заголовок */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span>Источники ({summary})</span>
      </button>

      {/* Список */}
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {enableGrouping && groups ? (
            // Сгруппированный режим
            groups.map((group) => (
              <GroupedCitationCard
                key={group.docId}
                group={group}
                workspaceId={workspaceId}
                defaultExpanded={groups.length === 1}
              />
            ))
          ) : (
            // Плоский список (fallback)
            citations.map((citation, index) => (
              <CitationCard
                key={citation.chunk_id || citation.doc_id || `citation-${index}`}
                citation={citation}
                workspaceId={workspaceId}
                index={index}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

type CitationCardProps = {
  citation: RagChunk;
  workspaceId?: string;
  index: number;
};

export function CitationCard({ citation, workspaceId, index }: CitationCardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const { toast } = useToast();
  
  const title = citation.doc_title?.trim() || `Документ ${index + 1}`;
  const sectionTitle = citation.section_title?.trim() || null;
  
  // Формируем сниппет
  const snippet = (() => {
    if (typeof citation.snippet === "string" && citation.snippet.trim().length > 0) {
      return citation.snippet.trim();
    }
    if (typeof citation.text === "string" && citation.text.trim().length > 0) {
      const text = citation.text.trim();
      return text.length > 200 ? `${text.slice(0, 200)}...` : text;
    }
    return null;
  })();

  // Формируем URL для перехода к документу
  const documentUrl = buildDocumentUrl(citation, workspaceId);
  
  // Формируем полный URL для копирования
  const fullUrl = documentUrl 
    ? `${window.location.origin}${documentUrl}`
    : null;

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.preventDefault(); // Предотвращаем переход по ссылке
    e.stopPropagation(); // Предотвращаем всплытие события
    
    if (!fullUrl) {
      toast({
        title: "Ошибка",
        description: "Ссылка недоступна для копирования",
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(fullUrl);
      setIsCopied(true);
      toast({
        title: "Ссылка скопирована",
        description: "Ссылка на источник скопирована в буфер обмена",
      });
      
      // Сбросить состояние через 2 секунды
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy link:", error);
      toast({
        title: "Не удалось скопировать",
        description: "Попробуйте ещё раз или скопируйте вручную",
        variant: "destructive",
      });
    }
  };

  const content = (
    <div className="flex items-start gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <FileText className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{title}</p>
            {sectionTitle && (
              <p className="truncate text-xs text-muted-foreground">{sectionTitle}</p>
            )}
          </div>
          
          {/* Кнопки действий */}
          <div className="flex shrink-0 items-center gap-1">
            {fullUrl && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={handleCopyLink}
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="sr-only">Копировать ссылку</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {isCopied ? "Скопировано!" : "Копировать ссылку"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {documentUrl && (
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </div>
        {snippet && (
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            "{snippet}"
          </p>
        )}
        {/* Мета-информация */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {citation.node_slug && (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono">
              {citation.node_slug}
            </span>
          )}
          {typeof citation.score === "number" && (
            <span className="inline-flex items-center gap-0.5">
              Релевантность: {(citation.score * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const cardElement = documentUrl ? (
    <a
      href={documentUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
    >
      {content}
    </a>
  ) : (
    <div className="rounded-lg border bg-card p-3">
      {content}
    </div>
  );

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        {cardElement}
      </HoverCardTrigger>
      <HoverCardContent 
        side="top" 
        align="start" 
        className="w-auto p-0"
        sideOffset={8}
      >
        <SourcePreviewCard citation={citation} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Формирует URL для перехода к документу в базе знаний
 */
function buildDocumentUrl(citation: RagChunk, workspaceId?: string): string | null {
  // Если есть node_id, формируем ссылку на документ
  const nodeId = citation.node_id || citation.doc_id;
  
  if (!nodeId) {
    return null;
  }

  // Пытаемся получить knowledge_base_id из citation
  const knowledgeBaseId = citation.knowledge_base_id;
  
  // Если есть knowledge_base_id, формируем правильную ссылку
  if (knowledgeBaseId) {
    return `/knowledge/${encodeURIComponent(knowledgeBaseId)}/node/${encodeURIComponent(nodeId)}`;
  }

  // Пытаемся извлечь knowledge base ID из document_url, если доступен
  // В payload из Qdrant может быть document_url вида /knowledge/{kb_id}/node/{node_id}
  const documentUrl = (citation as any).document_url as string | undefined;
  if (documentUrl && documentUrl.startsWith("/knowledge/")) {
    // Извлекаем kb_id из URL
    const match = documentUrl.match(/\/knowledge\/([^/]+)\/node\/([^/]+)/);
    if (match && match[1] && match[2]) {
      return `/knowledge/${encodeURIComponent(match[1])}/node/${encodeURIComponent(match[2])}`;
    }
    // Если формат другой, возвращаем как есть
    return documentUrl;
  }

  // Если нет knowledge_base_id и document_url, не можем сформировать ссылку
  return null;
}

export default ChatCitations;

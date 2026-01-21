/**
 * ChatSourcesPanel Component
 * 
 * Отображает панель с накопленными источниками из всех сообщений чата.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BookOpen, FileText, ExternalLink, Loader2 } from "lucide-react";
import type { RagChunk } from "@/types/search";

type ChatSourcesPanelProps = {
  chatId: string;
  workspaceId: string;
};

interface AccumulatedSource extends RagChunk {
  totalScore: number;
  usedInMessages: string[];
  firstUsedAt: string;
}

interface ChatSourcesResponse {
  chatId: string;
  totalSources: number;
  totalDocuments: number;
  sources: AccumulatedSource[];
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  
  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

function buildDocumentUrl(source: AccumulatedSource, workspaceId: string): string | null {
  if (!source.node_id || !source.knowledge_base_id) {
    return null;
  }
  return `/workspaces/${workspaceId}/knowledge/${source.knowledge_base_id}/nodes/${source.node_id}`;
}

type SourceCardProps = {
  source: AccumulatedSource;
  workspaceId: string;
};

function SourceCard({ source, workspaceId }: SourceCardProps) {
  const documentUrl = buildDocumentUrl(source, workspaceId);
  const usageCount = source.usedInMessages?.length ?? 1;
  const relevancePercent = ((source.totalScore || source.score || 0) * 100).toFixed(0);

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 shrink-0 text-primary mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{source.doc_title}</p>
          {source.section_title && (
            <p className="text-xs text-muted-foreground truncate">
              {source.section_title}
            </p>
          )}
          
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Использован {usageCount} {pluralize(usageCount, "раз", "раза", "раз")}
            </span>
            <span>•</span>
            <span>
              Релевантность {relevancePercent}%
            </span>
          </div>
        </div>
        
        {documentUrl && (
          <a
            href={documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1 hover:bg-accent rounded"
            aria-label="Открыть документ"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
        )}
      </div>
    </div>
  );
}

export function ChatSourcesPanel({ chatId, workspaceId }: ChatSourcesPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useQuery<ChatSourcesResponse>({
    queryKey: ["chat-sources", chatId],
    queryFn: async () => {
      const res = await fetch(`/api/chat/sessions/${chatId}/sources`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch sources");
      }
      return res.json();
    },
    enabled: isOpen && Boolean(chatId),
  });

  const totalSources = data?.totalSources ?? 0;
  const totalDocuments = data?.totalDocuments ?? 0;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="h-4 w-4" />
          <span className="text-xs">
            Источники: {totalSources > 0 ? totalSources : "—"}
          </span>
        </Button>
      </SheetTrigger>
      
      <SheetContent side="right" className="w-96">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Источники в диалоге
          </SheetTitle>
        </SheetHeader>
        
        <div className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Загрузка...
            </div>
          ) : !data || data.sources.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              В этом диалоге пока нет источников
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>{totalDocuments} документов</span>
                <span>{totalSources} фрагментов</span>
              </div>
              
              <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
                {data.sources.map((source, index) => (
                  <SourceCard 
                    key={source.chunk_id || index}
                    source={source}
                    workspaceId={workspaceId}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, ExternalLink, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RagChunk } from "@/types/search";
import type { GroupedCitation } from "./citationUtils";

type GroupedCitationCardProps = {
  group: GroupedCitation;
  workspaceId?: string;
  defaultExpanded?: boolean;
};

export function GroupedCitationCard({ 
  group, 
  workspaceId,
  defaultExpanded = false,
}: GroupedCitationCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasMultipleChunks = group.chunks.length > 1;
  
  const documentUrl = buildDocumentUrl({
    nodeId: group.nodeId,
    docId: group.docId,
    documentUrl: group.chunks[0] ? (group.chunks[0] as any).document_url : undefined,
    knowledgeBaseId: group.chunks[0] ? (group.chunks[0] as any).knowledge_base_id : undefined,
  }, workspaceId);

  // Если только один чанк — показываем как обычную карточку
  if (!hasMultipleChunks) {
    const chunk = group.chunks[0];
    return <SingleChunkCard chunk={chunk} workspaceId={workspaceId} />;
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Заголовок документа */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-start gap-2.5 p-3 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {group.docTitle}
              </p>
              <p className="text-xs text-muted-foreground">
                {group.chunks.length} фрагментов • Релевантность до {(group.topScore * 100).toFixed(0)}%
              </p>
            </div>
            
            <div className="flex shrink-0 items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Layers className="h-3 w-3" />
                {group.chunks.length}
              </span>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Развёрнутый список фрагментов */}
      {isExpanded && (
        <div className="border-t bg-muted/30">
          {group.chunks.map((chunk, index) => (
            <ChunkItem 
              key={chunk.chunk_id || `chunk-${index}`}
              chunk={chunk}
              index={index}
              isLast={index === group.chunks.length - 1}
            />
          ))}
          
          {/* Кнопка открытия документа */}
          {documentUrl && (
            <div className="border-t p-2">
              <a
                href={documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Открыть документ
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ChunkItemProps = {
  chunk: RagChunk;
  index: number;
  isLast: boolean;
};

function ChunkItem({ chunk, index, isLast }: ChunkItemProps) {
  const snippet = chunk.snippet?.trim() || chunk.text?.trim() || "";
  const displaySnippet = snippet.length > 150 
    ? `${snippet.slice(0, 150)}...` 
    : snippet;

  return (
    <div className={cn(
      "px-3 py-2",
      !isLast && "border-b border-dashed"
    )}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          #{index + 1}
        </span>
        <div className="min-w-0 flex-1">
          {chunk.section_title && (
            <p className="text-xs font-medium text-foreground mb-1">
              {chunk.section_title}
            </p>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            "{displaySnippet}"
          </p>
          {typeof chunk.score === "number" && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Релевантность: {(chunk.score * 100).toFixed(0)}%
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SingleChunkCard({ chunk, workspaceId }: { chunk: RagChunk; workspaceId?: string }) {
  // Обычная карточка для одного чанка (как в US-1)
  const documentUrl = buildDocumentUrl({ 
    nodeId: chunk.node_id, 
    docId: chunk.doc_id,
    documentUrl: (chunk as any).document_url,
    knowledgeBaseId: (chunk as any).knowledge_base_id,
  }, workspaceId);
  
  const snippet = chunk.snippet?.trim() || chunk.text?.trim() || "";
  const displaySnippet = snippet.length > 200 ? `${snippet.slice(0, 200)}...` : snippet;

  const content = (
    <div className="flex items-start gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <FileText className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {chunk.doc_title || "Документ"}
        </p>
        {chunk.section_title && (
          <p className="truncate text-xs text-muted-foreground">
            {chunk.section_title}
          </p>
        )}
        {displaySnippet && (
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            "{displaySnippet}"
          </p>
        )}
      </div>
      {documentUrl && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </div>
  );

  if (documentUrl) {
    return (
      <a
        href={documentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50"
      >
        {content}
      </a>
    );
  }

  return <div className="rounded-lg border bg-card p-3">{content}</div>;
}

function buildDocumentUrl(
  doc: { nodeId?: string | null; docId?: string; documentUrl?: string; knowledgeBaseId?: string },
  workspaceId?: string
): string | null {
  const nodeId = doc.nodeId || doc.docId;
  if (!nodeId) return null;

  // Пытаемся получить knowledge_base_id
  const knowledgeBaseId = doc.knowledgeBaseId;
  
  // Если есть knowledge_base_id, формируем правильную ссылку
  if (knowledgeBaseId) {
    return `/knowledge/${encodeURIComponent(knowledgeBaseId)}/node/${encodeURIComponent(nodeId)}`;
  }
  
  // Пытаемся извлечь knowledge base ID из documentUrl
  const documentUrl = doc.documentUrl;
  if (documentUrl && documentUrl.startsWith("/knowledge/")) {
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

export default GroupedCitationCard;

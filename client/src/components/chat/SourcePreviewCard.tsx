import { FileText, Calendar, User, Tag, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RagChunk } from "@/types/search";

type SourcePreviewCardProps = {
  citation: RagChunk;
  className?: string;
};

export function SourcePreviewCard({ citation, className }: SourcePreviewCardProps) {
  const title = citation.doc_title?.trim() || "Без названия";
  const sectionTitle = citation.section_title?.trim() || null;
  
  // Расширенный сниппет (до 500 символов)
  const extendedSnippet = (() => {
    const text = citation.text?.trim() || citation.snippet?.trim() || "";
    if (text.length <= 500) {
      return text;
    }
    // Обрезаем по последнему пробелу перед лимитом
    const truncated = text.slice(0, 500);
    const lastSpace = truncated.lastIndexOf(" ");
    return lastSpace > 400 ? `${truncated.slice(0, lastSpace)}...` : `${truncated}...`;
  })();

  // Метаданные из payload (если доступны)
  const metadata = {
    category: (citation as any).category || null,
    date: (citation as any).date || (citation as any).created_at || null,
    author: (citation as any).author || null,
    nodeSlug: citation.node_slug || null,
  };

  return (
    <div className={cn(
      "w-80 rounded-lg border bg-popover p-4 shadow-lg",
      className
    )}>
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-foreground line-clamp-2">{title}</h4>
          {sectionTitle && (
            <p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">
              {sectionTitle}
            </p>
          )}
        </div>
      </div>

      {/* Расширенный сниппет */}
      {extendedSnippet && (
        <div className="mt-3 rounded-md bg-muted/50 p-3">
          <p className="text-sm text-foreground leading-relaxed">
            {extendedSnippet}
          </p>
        </div>
      )}

      {/* Метаданные */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {metadata.category && (
          <span className="inline-flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {formatCategory(metadata.category)}
          </span>
        )}
        
        {metadata.date && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(metadata.date)}
          </span>
        )}
        
        {metadata.author && (
          <span className="inline-flex items-center gap-1">
            <User className="h-3 w-3" />
            {metadata.author}
          </span>
        )}
        
        {metadata.nodeSlug && (
          <span className="inline-flex items-center gap-1 font-mono">
            <LinkIcon className="h-3 w-3" />
            {metadata.nodeSlug}
          </span>
        )}
      </div>

      {/* Релевантность */}
      {typeof citation.score === "number" && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div 
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(citation.score * 100, 100)}%` }}
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {(citation.score * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Подсказка */}
      <p className="mt-3 text-center text-[10px] text-muted-foreground">
        Нажмите для открытия документа
      </p>
    </div>
  );
}

function formatCategory(category: string): string {
  const categoryMap: Record<string, string> = {
    "sud_resh_admin_pravo": "Административное право",
    "sud_resh_grazhd_pravo": "Гражданское право",
    "sud_resh_trud_pravo": "Трудовое право",
    "sud_resh_ugol_pravo": "Уголовное право",
    "sud_resh_sem_pravo": "Семейное право",
  };
  return categoryMap[category] || category;
}

function formatDate(date: string): string {
  try {
    return new Date(date).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return date;
  }
}

export default SourcePreviewCard;

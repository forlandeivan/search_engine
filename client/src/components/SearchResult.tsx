import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, X, Clock } from "lucide-react";

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  url: string;
  lastCrawled?: string;
  isFavorite?: boolean;
}

interface SearchResultProps {
  result: SearchResult;
  onToggleFavorite?: (id: string) => void;
  onRemove?: (id: string) => void;
  searchQuery?: string;
}

export default function SearchResult({ 
  result, 
  onToggleFavorite, 
  onRemove,
  searchQuery 
}: SearchResultProps) {
  const highlightText = (text: string, query?: string) => {
    if (!query) return text;
    
    const regex = new RegExp(`(${query})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <mark key={index} className="bg-primary/20 text-primary-foreground px-1 rounded">
          {part}
        </mark>
      ) : part
    );
  };

  return (
    <Card className="p-4 hover-elevate transition-all duration-200" data-testid={`card-result-${result.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 
              className="text-lg font-semibold text-primary hover:underline cursor-pointer truncate"
              data-testid={`text-title-${result.id}`}
              onClick={() => window.open(result.url, '_blank')}
            >
              {highlightText(result.title, searchQuery)}
            </h3>
            {result.isFavorite && (
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 flex-shrink-0" />
            )}
          </div>
          
          <p 
            className="text-muted-foreground text-sm mb-3 line-clamp-2"
            data-testid={`text-description-${result.id}`}
          >
            {highlightText(result.description, searchQuery)}
          </p>
          
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <a 
              href={result.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-primary font-mono truncate max-w-xs"
              data-testid={`link-url-${result.id}`}
            >
              {result.url}
            </a>
            {result.lastCrawled && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span data-testid={`text-crawled-${result.id}`}>
                  {new Date(result.lastCrawled).toLocaleDateString('ru')}
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 flex-shrink-0">
          {onToggleFavorite && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleFavorite(result.id)}
              data-testid={`button-favorite-${result.id}`}
              className="p-2"
            >
              <Star className={`h-4 w-4 ${result.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            </Button>
          )}
          {onRemove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(result.id)}
              data-testid={`button-remove-${result.id}`}
              className="p-2 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export type { SearchResult };
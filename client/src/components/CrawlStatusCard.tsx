import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Loader2, 
  Play, 
  Square,
  RefreshCw,
  Trash2
} from "lucide-react";

interface CrawlStatus {
  id: string;
  url: string;
  status: "idle" | "crawling" | "completed" | "failed";
  progress: number;
  pagesFound: number;
  pagesIndexed: number;
  lastCrawled?: Date;
  nextCrawl?: Date;
  error?: string;
}

interface CrawlStatusCardProps {
  crawlStatus: CrawlStatus;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const statusIcons = {
  idle: Clock,
  crawling: Loader2,
  completed: CheckCircle,
  failed: AlertCircle
};

const statusColors = {
  idle: "secondary",
  crawling: "default",
  completed: "default", 
  failed: "destructive"
} as const;

const statusLabels = {
  idle: "Ожидает",
  crawling: "Краулится",
  completed: "Завершено",
  failed: "Ошибка"
};

export default function CrawlStatusCard({ 
  crawlStatus, 
  onStart, 
  onStop, 
  onRetry,
  onDelete 
}: CrawlStatusCardProps) {
  const StatusIcon = statusIcons[crawlStatus.status];
  const isCrawling = crawlStatus.status === "crawling";
  
  return (
    <Card className="hover-elevate" data-testid={`card-crawl-${crawlStatus.id}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <StatusIcon 
            className={`h-4 w-4 ${isCrawling ? 'animate-spin' : ''} ${
              crawlStatus.status === 'failed' ? 'text-destructive' : 
              crawlStatus.status === 'completed' ? 'text-green-500' : ''
            }`} 
          />
          <Badge variant={statusColors[crawlStatus.status]}>
            {statusLabels[crawlStatus.status]}
          </Badge>
        </div>
        
        <div className="flex gap-1">
          {crawlStatus.status === "idle" && onStart && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onStart(crawlStatus.id)}
              data-testid={`button-start-${crawlStatus.id}`}
            >
              <Play className="h-3 w-3" />
            </Button>
          )}
          {crawlStatus.status === "crawling" && onStop && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onStop(crawlStatus.id)}
              data-testid={`button-stop-${crawlStatus.id}`}
            >
              <Square className="h-3 w-3" />
            </Button>
          )}
          {crawlStatus.status === "failed" && onRetry && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onRetry(crawlStatus.id)}
              data-testid={`button-retry-${crawlStatus.id}`}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          {onDelete && crawlStatus.status !== "crawling" && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => onDelete(crawlStatus.id)}
              data-testid={`button-delete-${crawlStatus.id}`}
              className="text-destructive hover:text-destructive-foreground hover:bg-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div>
          <h4 className="font-medium text-sm mb-1" data-testid={`text-url-${crawlStatus.id}`}>
            {crawlStatus.url}
          </h4>
          {crawlStatus.error && (
            <p className="text-destructive text-xs" data-testid={`text-error-${crawlStatus.id}`}>
              {crawlStatus.error}
            </p>
          )}
        </div>
        
        {isCrawling && (
          <div className="space-y-2">
            <Progress value={crawlStatus.progress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Прогресс: {crawlStatus.progress}%
            </p>
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Найдено страниц:</span>
            <p className="font-medium" data-testid={`text-found-${crawlStatus.id}`}>
              {crawlStatus.pagesFound}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Проиндексировано:</span>
            <p className="font-medium" data-testid={`text-indexed-${crawlStatus.id}`}>
              {crawlStatus.pagesIndexed}
            </p>
          </div>
        </div>
        
        {crawlStatus.lastCrawled && (
          <p className="text-xs text-muted-foreground">
            Последнее сканирование: {crawlStatus.lastCrawled.toLocaleString('ru')}
          </p>
        )}
        
        {crawlStatus.nextCrawl && (
          <p className="text-xs text-muted-foreground">
            Следующее сканирование: {crawlStatus.nextCrawl.toLocaleString('ru')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export type { CrawlStatus };
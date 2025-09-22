import { Link } from "wouter";
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
  Trash2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import type { MouseEvent } from "react";

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
  projectName?: string;
  projectDescription?: string | null;
  projectTypeLabel?: string;
  href?: string;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRetry?: (id: string) => void;
  onRecrawl?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const statusIcons = {
  idle: Clock,
  crawling: Loader2,
  completed: CheckCircle,
  failed: AlertCircle,
};

const statusColors = {
  idle: "secondary",
  crawling: "default",
  completed: "default",
  failed: "destructive",
} as const;

const statusLabels = {
  idle: "Ожидает",
  crawling: "Краулится",
  completed: "Завершено",
  failed: "Ошибка",
};

const LESS_THAN_MINUTE_THRESHOLD = 60 * 1000;
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

function formatLastCrawled(date: Date) {
  const lastCrawledDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(lastCrawledDate.getTime())) {
    return null;
  }

  const now = new Date();
  const diff = now.getTime() - lastCrawledDate.getTime();
  const absolute = format(lastCrawledDate, "d MMMM yyyy, HH:mm", { locale: ru });

  if (diff < 0) {
    return {
      label: formatDistanceToNow(lastCrawledDate, { addSuffix: true, locale: ru }),
      title: absolute,
    };
  }

  if (diff < LESS_THAN_MINUTE_THRESHOLD) {
    return {
      label: "меньше минуты назад",
      title: absolute,
    };
  }

  if (diff < WEEK_IN_MS) {
    return {
      label: formatDistanceToNow(lastCrawledDate, { addSuffix: true, locale: ru }),
      title: absolute,
    };
  }

  return {
    label: absolute,
    title: absolute,
  };
}

export default function CrawlStatusCard({
  crawlStatus,
  projectName,
  projectDescription,
  projectTypeLabel,
  href,
  onStart,
  onStop,
  onRetry,
  onRecrawl,
  onDelete,
}: CrawlStatusCardProps) {
  const StatusIcon = statusIcons[crawlStatus.status];
  const isCrawling = crawlStatus.status === "crawling";
  const lastCrawledInfo = crawlStatus.lastCrawled
    ? formatLastCrawled(crawlStatus.lastCrawled)
    : null;

  const handleActionClick = (
    event: MouseEvent<HTMLButtonElement>,
    action?: (id: string) => void,
  ) => {
    event.stopPropagation();
    if (href) {
      event.preventDefault();
    }
    action?.(crawlStatus.id);
  };

  const card = (
    <Card
      className={`hover-elevate ${href ? "transition-shadow hover:shadow-lg" : ""}`}
      data-testid={`card-crawl-${crawlStatus.id}`}
    >
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`h-4 w-4 ${isCrawling ? "animate-spin" : ""} ${
                crawlStatus.status === "failed"
                  ? "text-destructive"
                  : crawlStatus.status === "completed"
                  ? "text-green-500"
                  : ""
              }`}
            />
            <Badge variant={statusColors[crawlStatus.status]}>
              {statusLabels[crawlStatus.status]}
            </Badge>
            {projectTypeLabel && (
              <Badge variant="outline" className="hidden sm:inline-flex">
                {projectTypeLabel}
              </Badge>
            )}
          </div>

          <div className="flex gap-1">
            {crawlStatus.status === "idle" && onStart && (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => handleActionClick(event, onStart)}
                data-testid={`button-start-${crawlStatus.id}`}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
            {crawlStatus.status === "crawling" && onStop && (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => handleActionClick(event, onStop)}
                data-testid={`button-stop-${crawlStatus.id}`}
              >
                <Square className="h-3 w-3" />
              </Button>
            )}
            {crawlStatus.status === "failed" && onRetry && (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => handleActionClick(event, onRetry)}
                data-testid={`button-retry-${crawlStatus.id}`}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
            {crawlStatus.status === "completed" && onRecrawl && (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => handleActionClick(event, onRecrawl)}
                data-testid={`button-recrawl-${crawlStatus.id}`}
                title="Повторный краулинг для поиска новых страниц"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
            {onDelete && crawlStatus.status !== "crawling" && (
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => handleActionClick(event, onDelete)}
                data-testid={`button-delete-${crawlStatus.id}`}
                className="text-destructive hover:text-destructive-foreground hover:bg-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {projectTypeLabel && (
          <div className="sm:hidden">
            <Badge variant="outline">{projectTypeLabel}</Badge>
          </div>
        )}

        <div className="space-y-1">
          <h4 className="text-lg font-semibold leading-tight" data-testid={`text-project-${crawlStatus.id}`}>
            {projectName ?? crawlStatus.url}
          </h4>
          {projectDescription && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{projectDescription}</p>
          )}
          {crawlStatus.url && (
            <p className="break-all text-xs text-muted-foreground" data-testid={`text-url-${crawlStatus.id}`}>
              {crawlStatus.url}
            </p>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {crawlStatus.error && (
          <p className="text-xs text-destructive" data-testid={`text-error-${crawlStatus.id}`}>
            {crawlStatus.error}
          </p>
        )}

        {isCrawling && (
          <div className="space-y-2">
            <Progress value={crawlStatus.progress} className="h-2" />
            <p className="text-xs text-muted-foreground">Прогресс: {crawlStatus.progress}%</p>
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

        {lastCrawledInfo && (
          <p className="text-xs text-muted-foreground" title={lastCrawledInfo.title}>
            Последнее сканирование: {lastCrawledInfo.label}
          </p>
        )}

        {crawlStatus.nextCrawl && (
          <p className="text-xs text-muted-foreground">
            Следующее сканирование: {crawlStatus.nextCrawl.toLocaleString("ru")}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  ) : (
    card
  );
}

export type { CrawlStatus };

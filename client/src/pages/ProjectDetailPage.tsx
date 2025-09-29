import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  ChevronLeft,
  ExternalLink,
  FileDown,
  FileText,
  Gauge,
  Hash,
  Loader2,
  ListOrdered,
  MoreVertical,
  RefreshCw,
  ScrollText,
  Send,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { type Page, type Site, type PublicEmbeddingProvider } from "@shared/schema";
import { type ProjectVectorizationJobStatus } from "@shared/vectorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import CrawlerLogPanel from "@/components/CrawlerLogPanel";
import VectorizeProjectDialog from "@/components/VectorizeProjectDialog";
import VectorizationStatusCard from "@/components/VectorizationStatusCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<Site["status"], string> = {
  idle: "Ожидает",
  crawling: "Краулится",
  completed: "Завершено",
  failed: "Ошибка",
};

const statusVariants: Record<Site["status"], "default" | "secondary" | "destructive"> = {
  idle: "secondary",
  crawling: "default",
  completed: "default",
  failed: "destructive",
};

function formatDate(value?: string | Date | null) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("ru");
}

function formatDistance(value?: string | Date | null) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return formatDistanceToNow(date, { addSuffix: true, locale: ru });
}

interface JsonDialogState {
  open: boolean;
  page: Page | null;
  jsonText: string;
  webhookUrl: string;
}

function calculateWordCount(text?: string | null): number {
  if (!text) {
    return 0;
  }

  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export default function ProjectDetailPage() {
  const [match, params] = useRoute("/projects/:siteId");
  const siteId = params?.siteId ?? null;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: site,
    isLoading: siteLoading,
    error: siteError,
  } = useQuery<Site>({
    queryKey: ["/api/sites", siteId ?? ""],
    enabled: Boolean(siteId),
  });

  const {
    data: pages = [],
    isLoading: pagesLoading,
    error: pagesError,
  } = useQuery<Page[]>({
    queryKey: ["/api/sites", siteId ?? "", "pages"],
    enabled: Boolean(siteId),
    refetchInterval: () => (site?.status === "crawling" ? 5000 : false),
  });

  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
  });

  const [shouldPollVectorization, setShouldPollVectorization] = useState(false);
  const vectorizationStatusQuery = useQuery<{ status: ProjectVectorizationJobStatus }>({
    queryKey: ["/api/sites", siteId ?? "", "vectorization-status"],
    enabled: Boolean(siteId),
    refetchInterval: shouldPollVectorization ? 3000 : false,
  });

  const vectorizationStatus = vectorizationStatusQuery.data?.status ?? null;

  useEffect(() => {
    const nextShouldPoll =
      vectorizationStatus !== null &&
      (vectorizationStatus.status === "running" || vectorizationStatus.status === "pending");

    setShouldPollVectorization((current) => (current === nextShouldPoll ? current : nextShouldPoll));
  }, [vectorizationStatus]);

  const activeEmbeddingProviders = useMemo(
    () => (embeddingServices?.providers ?? []).filter((provider) => provider.isActive),
    [embeddingServices],
  );

  const isCrawling = site?.status === "crawling";
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<Page | null>(null);
  const [exportingPageId, setExportingPageId] = useState<string | null>(null);
  const [jsonDialogState, setJsonDialogState] = useState<JsonDialogState>({
    open: false,
    page: null,
    jsonText: "",
    webhookUrl: "",
  });
  const [isSendingJson, setIsSendingJson] = useState(false);

  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      const response = await fetch(`/api/pages/${pageId}`, { method: "DELETE" });

      if (!response.ok) {
        let errorMessage = "Не удалось удалить страницу";
        try {
          const data = await response.json();
          if (data?.error) {
            errorMessage = data.error;
          }
        } catch (error) {
          console.warn("Не удалось разобрать ответ удаления страницы", error);
        }

        throw new Error(errorMessage);
      }

      return response.json().catch(() => null);
    },
  });

  const resetJsonDialogState = () => {
    setJsonDialogState({ open: false, page: null, jsonText: "", webhookUrl: "" });
    setIsSendingJson(false);
  };

  const buildJsonPayloadForPage = (page: Page) => {
    const chunks = Array.isArray(page.chunks) ? page.chunks : [];
    const totalChunks = chunks.length;

    const payload = chunks.map((chunk, index) => {
      const charCount = chunk.metadata?.charCount ?? chunk.content.length;
      const wordCount = chunk.metadata?.wordCount ?? calculateWordCount(chunk.content);
      const chunkIndex = chunk.metadata?.position !== undefined ? chunk.metadata.position + 1 : index + 1;

      return {
        pageTitle: page.title ?? "Без названия",
        totalChunks,
        chunk: {
          heading: chunk.heading || `Чанк ${index + 1}`,
          index: chunkIndex,
          text: chunk.content,
          charCount,
          wordCount,
        },
      };
    });

    return JSON.stringify(payload, null, 2);
  };

  const openJsonDialogForPage = (page: Page) => {
    const payload = buildJsonPayloadForPage(page);
    setJsonDialogState({ open: true, page, jsonText: payload, webhookUrl: "" });
  };

  const handleDeleteConfirm = async () => {
    if (!pageToDelete) {
      return;
    }

    try {
      await deletePageMutation.mutateAsync(pageToDelete.id);
      await queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId ?? "", "pages"] });

      toast({
        title: "Страница удалена",
        description: `«${pageToDelete.title || pageToDelete.url || "Без названия"}» успешно удалена`,
      });

      setIsDeleteDialogOpen(false);
      setPageToDelete(null);
    } catch (error) {
      toast({
        title: "Ошибка удаления",
        description: error instanceof Error ? error.message : "Не удалось удалить страницу",
        variant: "destructive",
      });
    }
  };

  const handleExportPdf = async (page: Page) => {
    try {
      setExportingPageId(page.id);
      const { jsPDF } = await import("jspdf");
      const { notoSansRegularBase64, notoSansBoldBase64 } = await import("../pdfFonts/notoSans");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      doc.addFileToVFS("NotoSans-Regular.ttf", notoSansRegularBase64);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      doc.addFileToVFS("NotoSans-Bold.ttf", notoSansBoldBase64);
      doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
      const margin = 40;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let cursor = margin;

      const ensureSpace = (lineHeight: number) => {
        if (cursor + lineHeight > pageHeight - margin) {
          doc.addPage();
          cursor = margin;
        }
      };

      const addParagraph = (text: string, fontSize = 12, options?: { bold?: boolean; spacingAfter?: number }) => {
        if (!text) {
          cursor += options?.spacingAfter ?? fontSize * 0.2;
          return;
        }

        doc.setFont("NotoSans", options?.bold ? "bold" : "normal");
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
        const lineHeight = fontSize * 1.4;

        lines.forEach((line: string) => {
          ensureSpace(lineHeight);
          doc.text(line, margin, cursor);
          cursor += lineHeight;
        });

        cursor += options?.spacingAfter ?? fontSize * 0.6;
      };

      const chunks = Array.isArray(page.chunks) ? page.chunks : [];
      const chunkCharLimit = site?.maxChunkSize
        ?? chunks.reduce((max, chunk) => {
          const charCount = chunk.metadata?.charCount ?? chunk.content.length;
          return Math.max(max, charCount);
        }, 0);
      const totalChunks = chunks.length;
      const aggregatedContent = page.content ?? "";
      const aggregatedCharCount = aggregatedContent.length;
      const aggregatedWordCount = page.metadata?.wordCount ?? calculateWordCount(aggregatedContent);

      addParagraph(page.title || "Без названия", 18, { bold: true, spacingAfter: 6 });
      addParagraph(page.url ?? "", 11, { spacingAfter: 10 });
      addParagraph(`Всего чанков: ${totalChunks}`, 12, { spacingAfter: 2 });
      addParagraph(`Лимит символов чанка: ${chunkCharLimit}`, 12, { spacingAfter: 2 });
      addParagraph(`Символов (агрегировано): ${aggregatedCharCount}`, 12, { spacingAfter: 2 });
      addParagraph(`Слов (агрегировано): ${aggregatedWordCount}`, 12, { spacingAfter: 10 });

      chunks.forEach((chunk, index) => {
        const charCount = chunk.metadata?.charCount ?? chunk.content.length;
        const wordCount = chunk.metadata?.wordCount ?? calculateWordCount(chunk.content);
        const chunkIndex = chunk.metadata?.position !== undefined ? chunk.metadata.position + 1 : index + 1;

        addParagraph(`Чанк ${index + 1}: ${chunk.heading || "Без названия"}`, 14, { bold: true, spacingAfter: 4 });
        addParagraph(`Номер в странице: ${chunkIndex}`, 11, { spacingAfter: 2 });
        addParagraph(`Символов: ${charCount} · Слов: ${wordCount}`, 11, { spacingAfter: 6 });
        addParagraph(chunk.content, 11, { spacingAfter: 12 });
      });

      const fileNameBase = (page.title || page.url || "page")
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        || "page";

      doc.save(`${fileNameBase}.pdf`);

      toast({
        title: "PDF создан",
        description: "Файл успешно подготовлен и сохранён.",
      });
    } catch (error) {
      toast({
        title: "Ошибка выгрузки",
        description: error instanceof Error ? error.message : "Не удалось сформировать PDF",
        variant: "destructive",
      });
    } finally {
      setExportingPageId(null);
    }
  };

  const handleSendJson = async () => {
    const webhookUrl = jsonDialogState.webhookUrl.trim();

    if (!webhookUrl) {
      toast({
        title: "Укажите webhook URL",
        description: "Введите адрес, на который нужно отправить JSON.",
        variant: "destructive",
      });
      return;
    }

    try {
      const parsed = JSON.parse(jsonDialogState.jsonText);

      if (!Array.isArray(parsed)) {
        throw new Error("JSON должен быть массивом чанков");
      }
    } catch (error) {
      toast({
        title: "Некорректный JSON",
        description: error instanceof Error ? error.message : "Проверьте синтаксис JSON и повторите попытку.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingJson(true);

    try {
      const response = await fetch("/api/webhook/send-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl, payload: jsonDialogState.jsonText }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMessage =
          (result && (result.error ?? result.details)) ||
          "Сервер вернул ошибку";
        throw new Error(errorMessage);
      }

      toast({
        title: "JSON отправлен",
        description:
          (result && (result.message || result.details)) ||
          "Данные успешно переданы на указанный вебхук.",
      });

      resetJsonDialogState();
    } catch (error) {
      toast({
        title: "Ошибка отправки",
        description: error instanceof Error ? error.message : "Не удалось отправить JSON",
        variant: "destructive",
      });
    } finally {
      setIsSendingJson(false);
    }
  };

  const sortedPages = useMemo(() => {
    return pages
      .slice()
      .sort((a, b) => {
        const aTime = a.lastCrawled ? new Date(a.lastCrawled).getTime() : 0;
        const bTime = b.lastCrawled ? new Date(b.lastCrawled).getTime() : 0;
        return bTime - aTime;
      });
  }, [pages]);

  if (!match) {
    return null;
  }

  if (!siteId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTitle>Проект не найден</AlertTitle>
          <AlertDescription>Не удалось определить идентификатор проекта.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (siteError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить проект</AlertTitle>
          <AlertDescription>
            {(siteError as Error).message || "Попробуйте обновить страницу чуть позже."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-2 px-2">
          <Link href="/projects">
            <ChevronLeft className="h-4 w-4" />
            Назад к проектам
          </Link>
        </Button>
        {site && <Badge variant={statusVariants[site.status]}>{statusLabels[site.status]}</Badge>}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold leading-tight">
              {siteLoading ? <Skeleton className="h-7 w-48" /> : site?.url ?? "Проект"}
            </h1>
            {site && (
              <p className="text-sm text-muted-foreground">
                Глубина краулинга: {site.crawlDepth}. Внешние ссылки: {site.followExternalLinks ? "включены" : "выключены"}.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {site && (
              <VectorizeProjectDialog
                site={site}
                pages={sortedPages}
                providers={activeEmbeddingProviders}
                currentStatus={vectorizationStatus}
              />
            )}
            {site?.url && (
              <Button asChild variant="outline" size="sm" className="gap-2" disabled={!site?.url}>
                <a href={site.url} target="_blank" rel="noreferrer">
                  Открыть сайт
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {vectorizationStatus && vectorizationStatus.status !== "idle" && (
          <VectorizationStatusCard status={vectorizationStatus} />
        )}

        {site?.error && (
          <Alert variant="destructive">
            <AlertTitle>Последняя ошибка</AlertTitle>
            <AlertDescription>{site.error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Статус</p>
              <p className="text-base font-medium">{site ? statusLabels[site.status] : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Последний краулинг</p>
              <p className="text-base font-medium">
                {site?.lastCrawled ? formatDate(site.lastCrawled) : "Еще не выполнялся"}
              </p>
              {site?.lastCrawled && (
                <p className="text-xs text-muted-foreground">{formatDistance(site.lastCrawled)}</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Следующий краулинг</p>
              <p className="text-base font-medium">{formatDate(site?.nextCrawl)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Шаблоны исключений</p>
              <p className="text-base font-medium">
                {site?.excludePatterns?.length ? site.excludePatterns.join(", ") : "Отсутствуют"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Tabs defaultValue="pages" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pages">Проиндексированные страницы</TabsTrigger>
            <TabsTrigger value="coming-soon" disabled className="gap-2">
              <RefreshCw className="h-3 w-3" />
              Скоро
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pages">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Страницы проекта {site ? `(${sortedPages.length})` : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {pagesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-3/4" />
                  </div>
                ) : pagesError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Не удалось загрузить страницы</AlertTitle>
                    <AlertDescription>
                      {(pagesError as Error).message || "Повторите попытку позже."}
                    </AlertDescription>
                  </Alert>
                ) : sortedPages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                    <p>Страницы ещё не проиндексированы.</p>
                    {isCrawling ? (
                      <p>Краулинг выполняется, записи появятся автоматически.</p>
                    ) : (
                      <p>Запустите краулинг, чтобы начать индексировать страницы.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sortedPages.map((page) => {
                      const siteConfig = site ?? null;
                      const aggregatedContent = page.content ?? "";
                      const contentLength = aggregatedContent.length;
                      const aggregatedWordCount = page.metadata?.wordCount ?? calculateWordCount(aggregatedContent);
                      const chunks = Array.isArray(page.chunks) ? page.chunks : [];
                      const chunkCharCounts = chunks.map((chunk) => chunk.metadata?.charCount ?? chunk.content.length);
                      const chunkWordCounts = chunks.map((chunk) => chunk.metadata?.wordCount ?? calculateWordCount(chunk.content));
                      const chunkCount = chunks.length;
                      const totalChunkChars = chunkCharCounts.reduce((sum, value) => sum + value, 0);
                      const maxChunkLength = chunkCharCounts.reduce((max, value) => Math.max(max, value), 0);
                      const avgChunkLength = chunkCount > 0 ? Math.round(totalChunkChars / chunkCount) : 0;
                      const maxChunkWordCount = chunkWordCounts.reduce((max, value) => Math.max(max, value), 0);
                      const configuredChunkSize = siteConfig?.maxChunkSize ?? null;
                      const chunksOverLimit = configuredChunkSize
                        ? chunkCharCounts.filter((length) => length > configuredChunkSize).length
                        : 0;
                      const lastCrawledRelative = formatDistance(page.lastCrawled);
                      const hasStatusCode = typeof page.statusCode === "number";
                      const isCurrentPageDeleting = deletePageMutation.isPending && pageToDelete?.id === page.id;
                      const isCurrentPageExporting = exportingPageId === page.id;
                      const isCurrentPageSendingJson = isSendingJson && jsonDialogState.page?.id === page.id;

                      return (
                        <div
                          key={page.id}
                          className="rounded-lg border p-4 transition-colors hover-elevate"
                        >
                          <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-medium leading-tight">
                                    {page.title ? page.title : "Без названия"}
                                  </h3>
                                  {hasStatusCode && (
                                    <Badge variant="outline" className="text-[11px]">
                                      HTTP {page.statusCode}
                                    </Badge>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    asChild
                                    className="px-2"
                                  >
                                    <a href={page.url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </Button>
                                </div>
                                <p className="text-sm text-muted-foreground break-all">{page.url}</p>
                                {page.metaDescription && (
                                  <p className="text-sm text-muted-foreground line-clamp-2">{page.metaDescription}</p>
                                )}
                              </div>

                              <div className="flex items-center gap-2 self-start">
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="gap-2">
                                      <FileText className="h-4 w-4" />
                                      Содержимое
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-4xl max-h-[80vh]">
                                    <DialogHeader>
                                      <DialogTitle className="flex items-center gap-2">
                                        <span className="truncate">{page.title || "Без названия"}</span>
                                        <Button variant="ghost" size="sm" asChild>
                                          <a href={page.url} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="h-3 w-3" />
                                          </a>
                                        </Button>
                                      </DialogTitle>
                                      <p className="text-sm text-muted-foreground truncate">{page.url}</p>
                                    </DialogHeader>
                                    <ScrollArea className="h-96 w-full">
                                      <div className="space-y-4">
                                        {page.metaDescription && (
                                          <div>
                                            <h4 className="font-medium mb-2">Описание:</h4>
                                            <p className="text-sm text-muted-foreground">{page.metaDescription}</p>
                                          </div>
                                        )}
                                        <div>
                                          <h4 className="font-medium mb-2">Содержимое:</h4>
                                          <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                                            <span>Символов (агрегировано): {contentLength.toLocaleString("ru-RU")}</span>
                                            <span>Слов (агрегировано): {aggregatedWordCount.toLocaleString("ru-RU")}</span>
                                            {chunkCount > 0 && (
                                              <>
                                                <span>Чанков: {chunkCount.toLocaleString("ru-RU")}</span>
                                                <span>Макс. чанк: {maxChunkLength.toLocaleString("ru-RU")} символов</span>
                                                <span>Сред. чанк: {avgChunkLength.toLocaleString("ru-RU")} символов</span>
                                                <span>Макс. слов в чанке: {maxChunkWordCount.toLocaleString("ru-RU")}</span>
                                                {configuredChunkSize && (
                                                  <span>Лимит проекта: {configuredChunkSize.toLocaleString("ru-RU")} символов</span>
                                                )}
                                                {chunksOverLimit > 0 && (
                                                  <span className="text-destructive">
                                                    {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                                  </span>
                                                )}
                                              </>
                                            )}
                                          </div>
                                          {chunkCount > 0 && (
                                            <div className="mb-6 space-y-3">
                                              <h5 className="text-sm font-medium">Разбивка по чанкам:</h5>
                                              {chunks.map((chunk, index) => {
                                                const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
                                                const chunkWordCount = chunk.metadata?.wordCount ?? calculateWordCount(chunk.content);
                                                return (
                                                  <div
                                                    key={chunk.id || `${page.id}-chunk-${index}`}
                                                    className="rounded-lg border bg-muted/30 p-3"
                                                  >
                                                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                                      <div className="truncate text-sm font-medium">
                                                        {chunk.heading || `Чанк ${index + 1}`}
                                                      </div>
                                                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                                        <span>Символов: {chunkCharCount.toLocaleString("ru-RU")}</span>
                                                        <span>Слов: {chunkWordCount.toLocaleString("ru-RU")}</span>
                                                        {chunk.metadata?.position !== undefined && (
                                                          <span>Позиция: {chunk.metadata.position + 1}</span>
                                                        )}
                                                      </div>
                                                    </div>
                                                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                                                      {chunk.content}
                                                    </p>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                          <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
                                            {aggregatedContent}
                                          </pre>
                                        </div>
                                      </div>
                                    </ScrollArea>
                                  </DialogContent>
                                </Dialog>

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground"
                                      aria-label="Дополнительные действия"
                                      disabled={isCurrentPageDeleting || isCurrentPageSendingJson}
                                    >
                                      {isCurrentPageExporting || isCurrentPageDeleting || isCurrentPageSendingJson ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <MoreVertical className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuItem
                                      className="gap-2"
                                      disabled={isCurrentPageExporting}
                                      onSelect={(event) => {
                                        event.preventDefault();
                                        void handleExportPdf(page);
                                      }}
                                    >
                                      {isCurrentPageExporting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <FileDown className="h-4 w-4" />
                                      )}
                                      {isCurrentPageExporting ? "Подготовка PDF..." : "Выгрузить как PDF"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="gap-2"
                                      disabled={isCurrentPageSendingJson}
                                      onSelect={(event) => {
                                        event.preventDefault();
                                        openJsonDialogForPage(page);
                                      }}
                                    >
                                      {isCurrentPageSendingJson ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Send className="h-4 w-4" />
                                      )}
                                      {isCurrentPageSendingJson ? "Отправка..." : "Отправить как JSON"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="gap-2 text-destructive focus:text-destructive"
                                      disabled={isCurrentPageDeleting}
                                      onSelect={(event) => {
                                        event.preventDefault();
                                        setPageToDelete(page);
                                        setIsDeleteDialogOpen(true);
                                      }}
                                    >
                                      {isCurrentPageDeleting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                      {isCurrentPageDeleting ? "Удаление..." : "Удалить страницу"}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {lastCrawledRelative ? (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {lastCrawledRelative}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Дата неизвестна
                                </span>
                              )}
                              {page.contentHash && (
                                <span className="flex items-center gap-1">
                                  <Hash className="h-3 w-3" />
                                  {page.contentHash.substring(0, 8)}
                                </span>
                              )}
                              {chunkCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <ListOrdered className="h-3 w-3" />
                                  {chunkCount.toLocaleString("ru-RU")} чанков
                                </span>
                              )}
                              {chunkCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3 w-3" />
                                  макс {maxChunkLength.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {configuredChunkSize && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3 w-3" />
                                  лимит {configuredChunkSize.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {chunksOverLimit > 0 && (
                                <span className="text-destructive">
                                  {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex justify-end">
        <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <ScrollText className="h-4 w-4" />
              Лог краулинга
            </Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-3xl overflow-hidden p-0">
            <CrawlerLogPanel siteId={siteId} />
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open && !deletePageMutation.isPending) {
            setPageToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить страницу?</AlertDialogTitle>
            <AlertDialogDescription>
              {pageToDelete
                ? `Вы действительно хотите удалить страницу «${pageToDelete.title || pageToDelete.url || "Без названия"}»? Действие необратимо.`
                : "Вы действительно хотите удалить страницу? Действие необратимо."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              onClick={() => {
                if (!deletePageMutation.isPending) {
                  setPageToDelete(null);
                }
                setIsDeleteDialogOpen(false);
              }}
            >
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={deletePageMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              {deletePageMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Удаление...
                </span>
              ) : (
                "Удалить"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={jsonDialogState.open}
        onOpenChange={(open) => {
          if (!open) {
            resetJsonDialogState();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Отправка JSON: {jsonDialogState.page?.title || jsonDialogState.page?.url || "Страница"}
            </DialogTitle>
            <DialogDescription>
              Предпросмотр данных можно редактировать перед отправкой на указанный вебхук.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook URL</Label>
              <Input
                id="webhook-url"
                placeholder="https://example.com/webhook"
                value={jsonDialogState.webhookUrl}
                onChange={(event) =>
                  setJsonDialogState((prev) => ({ ...prev, webhookUrl: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="json-preview">JSON предпросмотр</Label>
              <Textarea
                id="json-preview"
                className="min-h-[280px] font-mono text-xs"
                value={jsonDialogState.jsonText}
                onChange={(event) =>
                  setJsonDialogState((prev) => ({ ...prev, jsonText: event.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={resetJsonDialogState}>
              Отмена
            </Button>
            <Button type="button" onClick={handleSendJson} disabled={isSendingJson}>
              {isSendingJson ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Отправка...
                </span>
              ) : (
                "Отправить JSON"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

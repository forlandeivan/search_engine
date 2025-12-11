import { useEffect, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCreateKnowledgeBase } from "@/hooks/useCreateKnowledgeBase";
import type { CreateKnowledgeBaseInput } from "@/hooks/useCreateKnowledgeBase";
import type { KnowledgeBase, KnowledgeBaseSourceType } from "@/lib/knowledge-base";
import { ChevronDown, ChevronUp, FolderArchive, Globe, HelpCircle, NotebookPen } from "lucide-react";

type CreationOption = {
  value: KnowledgeBaseSourceType;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

export const KNOWLEDGE_BASE_CREATION_OPTIONS: CreationOption[] = [
  {
    value: "blank",
    title: "Пустая база",
    description: "Создайте структуру с нуля и наполняйте контент вручную или с помощью AI.",
    icon: NotebookPen,
  },
  {
    value: "archive",
    title: "Импорт архива",
    description: "Загрузите ZIP-архив документов, чтобы автоматически разложить их в иерархию.",
    icon: FolderArchive,
  },
  {
    value: "crawler",
    title: "Краулинг сайта",
    description: "Подключите корпоративный портал или знания из публичного сайта для автообновления.",
    icon: Globe,
  },
];

type CreateKnowledgeBaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: KnowledgeBaseSourceType;
  onCreated?: (base: KnowledgeBase) => void;
  workspaceId?: string | null;
};

type FieldLabelWithTooltipProps = {
  label: string;
  tooltip: string;
  htmlFor?: string;
};

function FieldLabelWithTooltip({ label, tooltip, htmlFor }: FieldLabelWithTooltipProps) {
  return (
    <div className="flex items-center gap-2">
      {htmlFor ? (
        <label className="text-sm font-medium" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <p className="text-sm font-medium">{label}</p>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  initialMode = "blank",
  onCreated,
  workspaceId,
}: CreateKnowledgeBaseDialogProps) {
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<KnowledgeBaseSourceType>(initialMode);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startUrlsInput, setStartUrlsInput] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [allowedDomainsInput, setAllowedDomainsInput] = useState("");
  const [includePatternsInput, setIncludePatternsInput] = useState("");
  const [excludePatternsInput, setExcludePatternsInput] = useState("");
  const [maxPagesInput, setMaxPagesInput] = useState("");
  const [maxDepthInput, setMaxDepthInput] = useState("");
  const [rateLimitInput, setRateLimitInput] = useState("");
  const [robotsTxtEnabled, setRobotsTxtEnabled] = useState(true);
  const [selectorTitle, setSelectorTitle] = useState("");
  const [selectorContent, setSelectorContent] = useState("");
  const [language, setLanguage] = useState("");
  const [version, setVersion] = useState("");
  const [authHeadersInput, setAuthHeadersInput] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCrawlerAdvanced, setShowCrawlerAdvanced] = useState(false);
  const createBaseMutation = useCreateKnowledgeBase(workspaceId);

  const parseListInput = (value: string): string[] =>
    value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const parseNumberInput = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const parseHeadersInputToRecord = (value: string): Record<string, string> | undefined => {
    const headers: Record<string, string> = {};
    value
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
          return;
        }
        const key = line.slice(0, separatorIndex).trim();
        const headerValue = line.slice(separatorIndex + 1).trim();
        if (key && headerValue) {
          headers[key] = headerValue;
        }
      });

    return Object.keys(headers).length > 0 ? headers : undefined;
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setStartUrlsInput("");
    setSitemapUrl("");
    setAllowedDomainsInput("");
    setIncludePatternsInput("");
    setExcludePatternsInput("");
    setMaxPagesInput("");
    setMaxDepthInput("");
    setRateLimitInput("");
    setRobotsTxtEnabled(true);
    setSelectorTitle("");
    setSelectorContent("");
    setLanguage("");
    setVersion("");
    setAuthHeadersInput("");
    setArchiveFile(null);
    setError(null);
    setShowCrawlerAdvanced(false);
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (open) {
      setMode(initialMode);
    }
  }, [initialMode, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleModeChange = (value: KnowledgeBaseSourceType) => {
    setMode(value);
    setError(null);
    setShowCrawlerAdvanced(false);
    if (value !== "archive") {
      setArchiveFile(null);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = "";
      }
    }
    if (value !== "crawler") {
      setStartUrlsInput("");
      setSitemapUrl("");
      setAllowedDomainsInput("");
      setIncludePatternsInput("");
      setExcludePatternsInput("");
      setMaxPagesInput("");
      setMaxDepthInput("");
      setRateLimitInput("");
      setRobotsTxtEnabled(true);
      setSelectorTitle("");
      setSelectorContent("");
      setLanguage("");
      setVersion("");
      setAuthHeadersInput("");
    }
  };

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArchiveFile(file);
  };

  const handleSubmit = async () => {
    if (createBaseMutation.isPending) {
      return;
    }

    if (!name.trim()) {
      setError("Укажите название базы знаний");
      return;
    }

    if (mode === "archive" && !archiveFile) {
      setError("Выберите архив документов для импорта");
      return;
    }

    setError(null);

    try {
      let crawlerConfig: CreateKnowledgeBaseInput["crawlerConfig"] | undefined;
      if (mode === "crawler") {
        const startUrls = parseListInput(startUrlsInput);
        if (startUrls.length === 0) {
          setError("Укажите хотя бы один стартовый URL для краулинга");
          return;
        }

        const headersRecord = parseHeadersInputToRecord(authHeadersInput);

        crawlerConfig = {
          startUrls,
          sitemapUrl: sitemapUrl.trim() || undefined,
          allowedDomains: parseListInput(allowedDomainsInput),
          include: parseListInput(includePatternsInput),
          exclude: parseListInput(excludePatternsInput),
          maxPages: parseNumberInput(maxPagesInput),
          maxDepth: parseNumberInput(maxDepthInput),
          rateLimitRps: parseNumberInput(rateLimitInput),
          robotsTxt: robotsTxtEnabled,
          selectors: {
            title: selectorTitle.trim() || undefined,
            content: selectorContent.trim() || undefined,
          },
          language: language.trim() || undefined,
          version: version.trim() || undefined,
          authHeaders: headersRecord,
        };
      }

      const created = await createBaseMutation.mutateAsync({
        name,
        description,
        mode,
        archiveFile,
        crawlerConfig,
      });

      onCreated?.(created);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать базу знаний. Попробуйте снова.";
      setError(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Создание базы знаний</DialogTitle>
          <DialogDescription>
            Выберите подходящий сценарий, задайте название и при необходимости укажите источники данных.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {KNOWLEDGE_BASE_CREATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleModeChange(option.value)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 text-left transition",
                  mode === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <option.icon className="h-4 w-4" />
                  <span className="text-sm font-semibold">{option.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-base-name">
              Название базы знаний
            </label>
            <Input
              id="create-base-name"
              placeholder="Например, База знаний по клиентской поддержке"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="create-base-description">
              Краткое описание
            </label>
            <Textarea
              id="create-base-description"
              rows={3}
              placeholder="Расскажите, для чего нужна база знаний и какие процессы она покрывает"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {mode === "archive" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">ZIP-архив документов</label>
              <input
                ref={archiveInputRef}
                type="file"
                accept=".zip,.rar,.7z"
                className="hidden"
                onChange={handleArchiveChange}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => archiveInputRef.current?.click()}>
                  Выбрать архив
                </Button>
                {archiveFile ? (
                  <span className="text-xs text-muted-foreground">Выбрано: {archiveFile.name}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Поддерживаются ZIP, RAR и 7z архивы</span>
                )}
              </div>
            </div>
          )}

          {mode === "crawler" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="create-base-crawler-start-urls">
                  Стартовые URL
                </label>
                <Textarea
                  id="create-base-crawler-start-urls"
                  placeholder="https://example.com/docs\nhttps://docs.example.com/guide"
                  value={startUrlsInput}
                  onChange={(event) => setStartUrlsInput(event.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Перечислите адреса, с которых начнём обход. Каждый URL — с новой строки или через запятую.
                </p>
              </div>

              <Collapsible open={showCrawlerAdvanced} onOpenChange={setShowCrawlerAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex w-full items-center justify-between px-0 text-sm font-medium"
                  >
                    {showCrawlerAdvanced ? "Скрыть дополнительные настройки" : "Дополнительные настройки"}
                    {showCrawlerAdvanced ? (
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <TooltipProvider>
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-sitemap"
                            label="Sitemap (опционально)"
                            tooltip="Укажите ссылку на sitemap.xml или другой индекс, чтобы ускорить поиск страниц. Если поле пустое, краулер обойдётся без карты сайта."
                          />
                          <Input
                            id="create-base-crawler-sitemap"
                            placeholder="https://example.com/sitemap.xml"
                            value={sitemapUrl}
                            onChange={(event) => setSitemapUrl(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-domains"
                            label="Разрешённые домены"
                            tooltip="Список доменов, на которых можно продолжать обход. Все ссылки на сторонние ресурсы будут игнорироваться."
                          />
                          <Textarea
                            id="create-base-crawler-domains"
                            placeholder="example.com\nsub.example.com"
                            value={allowedDomainsInput}
                            onChange={(event) => setAllowedDomainsInput(event.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-include"
                            label="Включать пути / RegExp"
                            tooltip="Регулярные выражения или маски путей, которые должны попадать в базу. Сохраняем страницы только если URL соответствует хотя бы одному правилу."
                          />
                          <Textarea
                            id="create-base-crawler-include"
                            placeholder="/docs/.*"
                            value={includePatternsInput}
                            onChange={(event) => setIncludePatternsInput(event.target.value)}
                            rows={3}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-exclude"
                            label="Исключать пути / RegExp"
                            tooltip="URL, которые нужно пропустить. Если адрес подходит под правило, он не будет загружен и не попадёт в базу."
                          />
                          <Textarea
                            id="create-base-crawler-exclude"
                            placeholder="/blog/.*"
                            value={excludePatternsInput}
                            onChange={(event) => setExcludePatternsInput(event.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-max-pages"
                            label="Максимум страниц"
                            tooltip="Ограничение на общее число страниц, которые загрузит краулер. Помогает контролировать бюджет обхода."
                          />
                          <Input
                            id="create-base-crawler-max-pages"
                            type="number"
                            min={1}
                            placeholder="500"
                            value={maxPagesInput}
                            onChange={(event) => setMaxPagesInput(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-max-depth"
                            label="Максимальная глубина"
                            tooltip="Сколько уровней ссылок от стартовых страниц мы проходим. 0 — только стартовые URL, 1 — ссылки с них, и так далее."
                          />
                          <Input
                            id="create-base-crawler-max-depth"
                            type="number"
                            min={0}
                            placeholder="6"
                            value={maxDepthInput}
                            onChange={(event) => setMaxDepthInput(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-rate-limit"
                            label="Лимит RPS"
                            tooltip="Максимальное количество запросов в секунду к сайту. Уменьшите значение, чтобы не перегружать источник."
                          />
                          <Input
                            id="create-base-crawler-rate-limit"
                            type="number"
                            min={1}
                            placeholder="2"
                            value={rateLimitInput}
                            onChange={(event) => setRateLimitInput(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="space-y-1">
                          <FieldLabelWithTooltip
                            label="Учитывать robots.txt"
                            tooltip="При включении краулер проверяет правила Disallow/Allow и избегает запрещённых разделов сайта. Отключите, если у вас есть право обходить закрытые разделы."
                          />
                          <p className="text-xs text-muted-foreground">Краулер будет уважать правила доступа сайта.</p>
                        </div>
                        <Switch checked={robotsTxtEnabled} onCheckedChange={setRobotsTxtEnabled} />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-selector-title"
                            label="CSS-селектор заголовка"
                            tooltip="Селектор для поиска основного заголовка на странице. Используйте его, если заголовок отличается от стандартных h1/title."
                          />
                          <Input
                            id="create-base-crawler-selector-title"
                            placeholder="h1"
                            value={selectorTitle}
                            onChange={(event) => setSelectorTitle(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-selector-content"
                            label="CSS-селектор контента"
                            tooltip="Селектор контейнера с основным текстом. Помогает отфильтровать меню, футер и другие служебные блоки."
                          />
                          <Input
                            id="create-base-crawler-selector-content"
                            placeholder="article"
                            value={selectorContent}
                            onChange={(event) => setSelectorContent(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-language"
                            label="Язык контента"
                            tooltip="ISO-код языка (например, ru или en). Используется для улучшения качеcтва поиска и выбора модели обработки."
                          />
                          <Input
                            id="create-base-crawler-language"
                            placeholder="ru"
                            value={language}
                            onChange={(event) => setLanguage(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-version"
                            label="Версия документации"
                            tooltip="Дополнительный признак версии для документации. Можно указывать v2.0, release-2024 и т.п."
                          />
                          <Input
                            id="create-base-crawler-version"
                            placeholder="v2.0"
                            value={version}
                            onChange={(event) => setVersion(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <FieldLabelWithTooltip
                          htmlFor="create-base-crawler-headers"
                          label="Дополнительные HTTP-заголовки"
                          tooltip="Заголовки, которые будут отправляться в каждом запросе. Используйте для авторизации или передачи токенов доступа."
                        />
                        <Textarea
                          id="create-base-crawler-headers"
                          placeholder={"Authorization: Bearer <token>\nX-Token: secret"}
                          value={authHeadersInput}
                          onChange={(event) => setAuthHeadersInput(event.target.value)}
                          rows={3}
                        />
                        <p className="text-xs text-muted-foreground">Ключ: значение, каждый заголовок на отдельной строке.</p>
                      </div>
                    </div>
                  </TooltipProvider>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={createBaseMutation.isPending}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={createBaseMutation.isPending}>
            {createBaseMutation.isPending ? "Создаём..." : "Создать базу знаний"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeBaseDialog;

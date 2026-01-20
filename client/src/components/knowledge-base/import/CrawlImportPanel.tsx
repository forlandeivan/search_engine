import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, FileText, Globe, HelpCircle } from "lucide-react";
import type { CrawlMode, CrawlConfig } from "./types";

type FieldLabelWithTooltipProps = {
  label: string;
  tooltip: string;
  htmlFor?: string;
};

function FieldLabelWithTooltip({ label, tooltip, htmlFor }: FieldLabelWithTooltipProps) {
  return (
    <div className="flex items-center gap-2">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
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

type CrawlImportPanelProps = {
  mode: CrawlMode;
  onModeChange: (mode: CrawlMode) => void;

  // Для single mode
  singleUrl: string;
  onSingleUrlChange: (url: string) => void;

  // Для multiple mode
  config: CrawlConfig;
  onConfigChange: (config: CrawlConfig) => void;

  // Состояние
  isSubmitting?: boolean;
  error?: string | null;
  disabled?: boolean;
};

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

function SinglePageCrawlForm({
  url,
  onChange,
  disabled,
}: {
  url: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="crawl-single-url">Ссылка на страницу</Label>
      <Input
        id="crawl-single-url"
        type="url"
        value={url}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://example.com/article"
        disabled={disabled}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        Заголовок документа будет определён автоматически по содержимому страницы.
      </p>
    </div>
  );
}

function MultiplePagesCrawlForm({
  config,
  onChange,
  disabled,
}: {
  config: CrawlConfig;
  onChange: (config: CrawlConfig) => void;
  disabled?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const startUrlsInput = config.startUrls.join("\n");
  const sitemapUrl = config.sitemapUrl ?? "";
  const allowedDomainsInput = config.allowedDomains?.join("\n") ?? "";
  const includePatternsInput = config.include?.join("\n") ?? "";
  const excludePatternsInput = config.exclude?.join("\n") ?? "";
  const maxPagesInput = config.maxPages?.toString() ?? "";
  const maxDepthInput = config.maxDepth?.toString() ?? "";
  const rateLimitInput = config.rateLimitRps?.toString() ?? "";
  const robotsTxtEnabled = config.robotsTxt ?? true;
  const selectorTitle = config.selectors?.title ?? "";
  const selectorContent = config.selectors?.content ?? "";
  const language = config.language ?? "";
  const version = config.version ?? "";
  const authHeadersInput = config.authHeaders
    ? Object.entries(config.authHeaders)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")
    : "";

  return (
    <div className="space-y-4">
      {/* Стартовые URL */}
      <div className="space-y-2">
        <Label htmlFor="crawl-start-urls">Стартовые URL</Label>
        <Textarea
          id="crawl-start-urls"
          placeholder="https://example.com/docs\nhttps://docs.example.com/guide"
          value={startUrlsInput}
          onChange={(e) =>
            onChange({
              ...config,
              startUrls: parseListInput(e.target.value),
            })
          }
          rows={3}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Перечислите адреса, с которых начнём обход. Каждый URL — с новой строки или через запятую.
        </p>
      </div>

      {/* Collapsible: Дополнительные настройки */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="flex w-full items-center justify-between px-0 text-sm font-medium"
            disabled={disabled}
          >
            {showAdvanced ? "Скрыть дополнительные настройки" : "Дополнительные настройки"}
            {showAdvanced ? (
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
                    htmlFor="crawl-sitemap"
                    label="Sitemap (опционально)"
                    tooltip="Укажите ссылку на sitemap.xml или другой индекс, чтобы ускорить поиск страниц. Если поле пустое, краулер обойдётся без карты сайта."
                  />
                  <Input
                    id="crawl-sitemap"
                    placeholder="https://example.com/sitemap.xml"
                    value={sitemapUrl}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        sitemapUrl: e.target.value.trim() || undefined,
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-domains"
                    label="Разрешённые домены"
                    tooltip="Список доменов, на которых можно продолжать обход. Все ссылки на сторонние ресурсы будут игнорироваться."
                  />
                  <Textarea
                    id="crawl-domains"
                    placeholder="example.com\nsub.example.com"
                    value={allowedDomainsInput}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        allowedDomains: parseListInput(e.target.value),
                      })
                    }
                    rows={3}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-include"
                    label="Включать пути / RegExp"
                    tooltip="Регулярные выражения или маски путей, которые должны попадать в базу. Сохраняем страницы только если URL соответствует хотя бы одному правилу."
                  />
                  <Textarea
                    id="crawl-include"
                    placeholder="/docs/.*"
                    value={includePatternsInput}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        include: parseListInput(e.target.value),
                      })
                    }
                    rows={3}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-exclude"
                    label="Исключать пути / RegExp"
                    tooltip="URL, которые нужно пропустить. Если адрес подходит под правило, он не будет загружен и не попадёт в базу."
                  />
                  <Textarea
                    id="crawl-exclude"
                    placeholder="/blog/.*"
                    value={excludePatternsInput}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        exclude: parseListInput(e.target.value),
                      })
                    }
                    rows={3}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-max-pages"
                    label="Максимум страниц"
                    tooltip="Ограничение на общее число страниц, которые загрузит краулер. Помогает контролировать бюджет обхода."
                  />
                  <Input
                    id="crawl-max-pages"
                    type="number"
                    min={1}
                    placeholder="500"
                    value={maxPagesInput}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        maxPages: parseNumberInput(e.target.value),
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-max-depth"
                    label="Максимальная глубина"
                    tooltip="Сколько уровней ссылок от стартовых страниц мы проходим. 0 — только стартовые URL, 1 — ссылки с них, и так далее."
                  />
                  <Input
                    id="crawl-max-depth"
                    type="number"
                    min={0}
                    placeholder="6"
                    value={maxDepthInput}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        maxDepth: parseNumberInput(e.target.value),
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-rate-limit"
                    label="Лимит RPS"
                    tooltip="Максимальное количество запросов в секунду к сайту. Уменьшите значение, чтобы не перегружать источник."
                  />
                  <Input
                    id="crawl-rate-limit"
                    type="number"
                    min={1}
                    placeholder="2"
                    value={rateLimitInput}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        rateLimitRps: parseNumberInput(e.target.value),
                      })
                    }
                    disabled={disabled}
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
                <Switch
                  checked={robotsTxtEnabled}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...config,
                      robotsTxt: checked,
                    })
                  }
                  disabled={disabled}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-selector-title"
                    label="CSS-селектор заголовка"
                    tooltip="Селектор для поиска основного заголовка на странице. Используйте его, если заголовок отличается от стандартных h1/title."
                  />
                  <Input
                    id="crawl-selector-title"
                    placeholder="h1"
                    value={selectorTitle}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        selectors: {
                          ...config.selectors,
                          title: e.target.value.trim() || undefined,
                        },
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-selector-content"
                    label="CSS-селектор контента"
                    tooltip="Селектор контейнера с основным текстом. Помогает отфильтровать меню, футер и другие служебные блоки."
                  />
                  <Input
                    id="crawl-selector-content"
                    placeholder="article"
                    value={selectorContent}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        selectors: {
                          ...config.selectors,
                          content: e.target.value.trim() || undefined,
                        },
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-language"
                    label="Язык контента"
                    tooltip="ISO-код языка (например, ru или en). Используется для улучшения качеcтва поиска и выбора модели обработки."
                  />
                  <Input
                    id="crawl-language"
                    placeholder="ru"
                    value={language}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        language: e.target.value.trim() || undefined,
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabelWithTooltip
                    htmlFor="crawl-version"
                    label="Версия документации"
                    tooltip="Дополнительный признак версии для документации. Можно указывать v2.0, release-2024 и т.п."
                  />
                  <Input
                    id="crawl-version"
                    placeholder="v2.0"
                    value={version}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        version: e.target.value.trim() || undefined,
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <FieldLabelWithTooltip
                  htmlFor="crawl-headers"
                  label="Дополнительные HTTP-заголовки"
                  tooltip="Заголовки, которые будут отправляться в каждом запросе. Используйте для авторизации или передачи токенов доступа."
                />
                <Textarea
                  id="crawl-headers"
                  placeholder={"Authorization: Bearer <token>\nX-Token: secret"}
                  value={authHeadersInput}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      authHeaders: parseHeadersInputToRecord(e.target.value),
                    })
                  }
                  rows={3}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">Ключ: значение, каждый заголовок на отдельной строке.</p>
              </div>
            </div>
          </TooltipProvider>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function CrawlImportPanel({
  mode,
  onModeChange,
  singleUrl,
  onSingleUrlChange,
  config,
  onConfigChange,
  isSubmitting,
  error,
  disabled,
}: CrawlImportPanelProps) {
  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
        <Button
          type="button"
          variant={mode === "single" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("single")}
          disabled={disabled || isSubmitting}
        >
          <FileText className="w-4 h-4 mr-2" />
          Одна страница
        </Button>
        <Button
          type="button"
          variant={mode === "multiple" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("multiple")}
          disabled={disabled || isSubmitting}
        >
          <Globe className="w-4 h-4 mr-2" />
          Несколько страниц
        </Button>
      </div>

      {/* Контент */}
      {mode === "single" ? (
        <SinglePageCrawlForm url={singleUrl} onChange={onSingleUrlChange} disabled={disabled || isSubmitting} />
      ) : (
        <MultiplePagesCrawlForm config={config} onChange={onConfigChange} disabled={disabled || isSubmitting} />
      )}

      {/* Ошибки */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <HelpCircle className="h-4 w-4" />
          {error}
        </div>
      )}
    </div>
  );
}

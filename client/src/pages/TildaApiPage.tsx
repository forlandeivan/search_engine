import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, ExternalLink, Search, Globe, Code2, RefreshCw, Loader2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type Site } from "@shared/schema";

export default function TildaApiPage() {
  const sections = [
    {
      id: "public-api",
      title: "Публичный API поиска",
      description: "Получите ключи доступа и примеры запросов.",
      icon: Search,
    },
    {
      id: "tilda",
      title: "Tilda",
      description: "Готовая интеграция для сайтов на Tilda.",
      icon: Globe,
    },
  ];
  const [activeSection, setActiveSection] = useState(sections[0].id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sites = [], isLoading: isSitesLoading } = useQuery<Site[]>({
    queryKey: ["/api/sites"],
  });
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>();

  useEffect(() => {
    if (sites.length > 0 && !selectedSiteId) {
      setSelectedSiteId(sites[0].id);
    }
  }, [sites, selectedSiteId]);

  const selectedSite = useMemo(() => {
    if (sites.length === 0) {
      return undefined;
    }

    if (selectedSiteId) {
      return sites.find((site) => site.id === selectedSiteId) ?? sites[0];
    }

    return sites[0];
  }, [sites, selectedSiteId]);

  const currentDomain =
    typeof window !== "undefined" ? window.location.origin : "https://ваш-домен.replit.dev";
  const publicApiBase = `${currentDomain}/api/public`;
  const apiEndpoint = publicApiBase;
  const publicSearchEndpoint = selectedSite
    ? `${publicApiBase}/collections/${selectedSite.publicId}/search`
    : `${publicApiBase}/collections/YOUR_COLLECTION_ID/search`;
  const vectorExampleCollection = selectedSite?.publicId ?? "COLLECTION_NAME";
  const vectorSearchEndpoint = `${currentDomain}/api/vector/collections/${vectorExampleCollection}/search`;

  const rotateApiKey = useMutation<{ site: Site; apiKey: string }, Error, string>({
    mutationFn: async (siteId: string) => {
      const response = await apiRequest("POST", `/api/sites/${siteId}/api-key/rotate`);
      return (await response.json()) as { site: Site; apiKey: string };
    },
    onSuccess: (data) => {
      toast({
        title: "API-ключ обновлён",
        description: "Новый ключ применён. Не забудьте обновить интеграции.",
      });
      setSelectedSiteId(data.site.id);
      queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
    },
    onError: () => {
      toast({
        title: "Не удалось обновить ключ",
        description: "Попробуйте ещё раз через несколько секунд.",
        variant: "destructive",
      });
    },
  });

  const zeroBlockHtml = `<div id="search-widget" class="search-container">
  <div class="search-box">
    <input type="text" id="search-input" placeholder="Поиск по сайту..." class="search-input">
    <button id="search-button" class="search-button">
      <svg class="search-icon" viewBox="0 0 24 24">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
    </button>
  </div>
  <div id="search-loading" class="search-loading hidden">
    <div class="loading-spinner"></div>
    <span>Поиск...</span>
  </div>
  <div id="search-results" class="search-results"></div>
  <div id="search-stats" class="search-stats hidden"></div>
  <div id="search-error" class="search-error hidden"></div>
</div>`;

  const zeroBlockCss = `<style>
.search-container {
  max-width: 600px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0,0,0,0.04);
}

.search-box:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59,130,246,0.15);
}

.search-input {
  flex: 1;
  padding: 16px 20px;
  border: none;
  outline: none;
  font-size: 16px;
  background: transparent;
  color: #1f2937;
}

.search-input::placeholder {
  color: #9ca3af;
}

.search-button {
  padding: 12px;
  margin: 4px;
  background: #3b82f6;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-button:hover {
  background: #2563eb;
}

.search-icon {
  width: 20px;
  height: 20px;
  stroke: white;
  stroke-width: 2;
  fill: none;
}

.search-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #6b7280;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.search-results {
  margin-top: 24px;
}

.result-item {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.result-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59,130,246,0.1);
}

.result-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 8px;
  text-decoration: none;
}

.result-title:hover {
  color: #3b82f6;
}

.result-url {
  font-size: 14px;
  color: #059669;
  margin-bottom: 8px;
  word-break: break-all;
}

.result-description {
  color: #4b5563;
  line-height: 1.5;
}

.search-stats {
  text-align: center;
  padding: 16px;
  color: #6b7280;
  font-size: 14px;
  background: #f9fafb;
  border-radius: 8px;
  margin-top: 16px;
}

.search-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 16px;
  border-radius: 8px;
  margin-top: 16px;
}

.hidden {
  display: none !important;
}

.no-results {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
}

@media (max-width: 768px) {
  .search-container { margin: 0 16px; }
  .search-input { font-size: 16px; }
  .result-item { padding: 16px; }
}
</style>`;

  const zeroBlockJsLines = [
    "<script>",
    "const API_ENDPOINT = '__API_ENDPOINT__';",
    "const COLLECTION_ID = '__COLLECTION_ID__';",
    "const API_KEY = '__API_KEY__';",
    "",
    "class TildaSearchWidget {",
    "  constructor(apiEndpoint) {",
    "    this.apiEndpoint = apiEndpoint;",
    "    this.debounceTimeout = null;",
    "    this.currentQuery = '';",
    "    this.controller = null;",
    "    this.init();",
    "  }",
    "",
    "  init() {",
    "    this.searchInput = document.getElementById('search-input');",
    "    this.searchButton = document.getElementById('search-button');",
    "    this.loadingEl = document.getElementById('search-loading');",
    "    this.resultsEl = document.getElementById('search-results');",
    "    this.statsEl = document.getElementById('search-stats');",
    "    this.errorEl = document.getElementById('search-error');",
    "",
    "    if (!this.searchInput || !this.searchButton) {",
    "      console.error('Поисковый виджет не найден в DOM');",
    "      return;",
    "    }",
    "",
    "    this.searchInput.addEventListener('input', (event) => this.handleInput(event));",
    "    this.searchInput.addEventListener('keypress', (event) => {",
    "      if (event.key === 'Enter') {",
    "        event.preventDefault();",
    "        this.performSearch(event.target.value.trim());",
    "      }",
    "    });",
    "    this.searchButton.addEventListener('click', () => {",
    "      this.performSearch(this.searchInput.value.trim());",
    "    });",
    "  }",
    "",
    "  handleInput(event) {",
    "    const query = event.target.value.trim();",
    "    clearTimeout(this.debounceTimeout);",
    "",
    "    if (query.length === 0) {",
    "      this.clearResults();",
    "      return;",
    "    }",
    "",
    "    this.debounceTimeout = setTimeout(() => {",
    "      if (query.length >= 2) {",
    "        this.performSearch(query);",
    "      }",
    "    }, 300);",
    "  }",
    "",
    "  async performSearch(query) {",
    "    if (!query || query.length < 2) {",
    "      this.showError('Введите минимум 2 символа для поиска');",
    "      return;",
    "    }",
    "",
    "    this.currentQuery = query;",
    "    this.showLoading();",
    "    this.hideError();",
    "",
    "    if (this.controller) {",
    "      this.controller.abort();",
    "    }",
    "    this.controller = new AbortController();",
    "",
    "    try {",
    "      const response = await fetch(",
    "        `${this.apiEndpoint}/collections/${COLLECTION_ID}/search`,",
    "        {",
    "          method: 'POST',",
    "          headers: {",
    "            'Content-Type': 'application/json',",
    "            'X-API-Key': API_KEY",
    "          },",
    "          body: JSON.stringify({ query, hitsPerPage: 10 }),",
    "          signal: this.controller.signal",
    "        }",
    "      );",
    "",
    "      if (!response.ok) {",
    "        throw new Error('HTTP ' + response.status);",
    "      }",
    "",
    "      const data = await response.json();",
    "      this.displayResults(data, query);",
    "    } catch (error) {",
    "      if (error.name !== 'AbortError') {",
    "        this.showError('Ошибка поиска. Попробуйте позже.');",
    "        console.error('Search error:', error);",
    "      }",
    "    } finally {",
    "      this.hideLoading();",
    "    }",
    "  }",
    "",
    "  displayResults(data, query) {",
    "    const results = data.hits || [];",
    "    const total = data.nbHits || 0;",
    "",
    "    if (!results.length) {",
    "      this.resultsEl.innerHTML = `",
    "        <div class=\"no-results\">",
    "          <p>По запросу <strong>\"\\${this.escapeHtml(query)}\"</strong> ничего не найдено</p>",
    "        </div>",
    "      `;",
    "      this.hideStats();",
    "      return;",
    "    }",
    "",
    "    this.resultsEl.innerHTML = results.map((result) => this.renderResult(result, query)).join('');",
    "    this.showStats(total, query);",
    "  }",
    "",
    "  renderResult(result, query) {",
    "    const title = result.title || 'Без названия';",
    "    const description = this.truncateText(result.excerpt || result.content || '', 200);",
    "",
    "    return `",
    "      <div class=\"result-item\" onclick=\"window.open('\\${result.url}', '_blank')\">",
    "        <a href=\"\\${result.url}\" target=\"_blank\" class=\"result-title\" onclick=\"event.stopPropagation()\">",
    "          \\${this.highlight(this.escapeHtml(title), query)}",
    "        </a>",
    "        <div class=\"result-url\">\\${this.escapeHtml(result.url)}</div>",
    "        <div class=\"result-description\">\\${this.highlight(this.escapeHtml(description), query)}</div>",
    "      </div>",
    "    `;",
    "  }",
    "",
    "  highlight(text, query) {",
    "    const words = query.split(/\\s+/).filter((word) => word.length > 1);",
    "    let highlighted = text;",
    "",
    "    words.forEach((word) => {",
    "      const regexp = new RegExp('(' + this.escapeRegex(word) + ')', 'gi');",
    "      highlighted = highlighted.replace(regexp, '<mark>$1</mark>');",
    "    });",
    "",
    "    return highlighted;",
    "  }",
    "",
    "  truncateText(text, max) {",
    "    return text.length <= max ? text : text.slice(0, max).replace(/\\s+\\S*$/, '') + '...';",
    "  }",
    "",
    "  escapeHtml(text) {",
    "    const helper = document.createElement('div');",
    "    helper.textContent = text;",
    "    return helper.innerHTML;",
    "  }",
    "",
    "  escapeRegex(text) {",
    "    return text.replace(/[.*+?^\\${}()|[\\]\\\\]/g, '\\\\$&');",
    "  }",
    "",
    "  showLoading() {",
    "    this.loadingEl.classList.remove('hidden');",
    "    this.resultsEl.innerHTML = '';",
    "    this.hideStats();",
    "  }",
    "",
    "  hideLoading() {",
    "    this.loadingEl.classList.add('hidden');",
    "  }",
    "",
    "  showStats(total, query) {",
    "    this.statsEl.innerHTML = 'Найдено <strong>' + total + '</strong> по запросу <strong>\"' + this.escapeHtml(query) + '\"</strong>';",
    "    this.statsEl.classList.remove('hidden');",
    "  }",
    "",
    "  hideStats() {",
    "    this.statsEl.classList.add('hidden');",
    "  }",
    "",
    "  showError(message) {",
    "    this.errorEl.innerHTML = message;",
    "    this.errorEl.classList.remove('hidden');",
    "    this.resultsEl.innerHTML = '';",
    "    this.hideStats();",
    "  }",
    "",
    "  hideError() {",
    "    this.errorEl.classList.add('hidden');",
    "  }",
    "",
    "  clearResults() {",
    "    this.resultsEl.innerHTML = '';",
    "    this.hideStats();",
    "    this.hideError();",
    "  }",
    "}",
    "",
    "document.addEventListener('DOMContentLoaded', function () {",
    "  const searchWidget = new TildaSearchWidget(API_ENDPOINT);",
    "  window.searchWidget = searchWidget;",
    "});",
    "</script>"
  ];
  let zeroBlockJs = zeroBlockJsLines.join("\n");
  zeroBlockJs = zeroBlockJs.replace('__API_ENDPOINT__', apiEndpoint);
  zeroBlockJs = zeroBlockJs.replace('__COLLECTION_ID__', selectedSite?.publicId ?? 'YOUR_COLLECTION_ID');
  zeroBlockJs = zeroBlockJs.replace('__API_KEY__', selectedSite?.publicApiKey ?? 'YOUR_API_KEY');

  const zeroBlockFull = [zeroBlockHtml, '', zeroBlockCss, '', zeroBlockJs].join('\n');

  const copyToClipboard = async (text: string, label?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Скопировано",
        description: label ? `${label} скопирован в буфер обмена.` : "Значение скопировано в буфер обмена.",
      });
    } catch (error) {
      console.error("Clipboard error", error);
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте значение вручную.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Code2 className="h-8 w-8" />
          Документация API
        </h1>
        <p className="text-lg text-muted-foreground">
          Выберите платформу, чтобы подключить поисковый движок и настроить интеграцию под свои задачи.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:gap-8">
        <Card className="h-fit shadow-sm">
          <CardHeader>
            <CardTitle>Разделы документации</CardTitle>
            <CardDescription>Инструкции по интеграциям и виджетам</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <Button
                  key={section.id}
                  variant={activeSection === section.id ? "secondary" : "ghost"}
                  className="w-full items-start justify-start gap-3 whitespace-normal rounded-lg px-4 py-3 text-left"
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col items-start text-left">
                    <span className="font-semibold leading-tight">{section.title}</span>
                    <span className="text-xs text-muted-foreground">{section.description}</span>
                  </div>
                </Button>
              );
            })}
          </CardContent>
        </Card>

        {activeSection === "public-api" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-bold mb-2 flex items-center gap-2">
                <Search className="h-8 w-8" />
                Публичный API поиска
              </h2>
              <p className="text-lg text-muted-foreground">
                Получите идентификаторы коллекций и API-ключи, чтобы подключить поиск в своих приложениях и на сторонних платформах.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Ваши коллекции</CardTitle>
                <CardDescription>
                  Используйте идентификатор коллекции и API-ключ, чтобы выполнять запросы к публичному поиску.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isSitesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Загружаем список коллекций…</span>
                  </div>
                ) : sites.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    У вас пока нет коллекций. Добавьте проект и запустите краулинг, чтобы получить API-доступ.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {sites.map((site) => {
                      const endpoint = `${publicApiBase}/collections/${site.publicId}/search`;
                      const isActive = selectedSite?.id === site.id;
                      return (
                        <div
                          key={site.id}
                          className={`rounded-lg border p-4 space-y-4 transition ${
                            isActive ? "border-primary shadow-sm" : "border-border"
                          }`}
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <h3 className="font-semibold text-lg">{site.name}</h3>
                              <p className="text-sm text-muted-foreground break-all">{site.url}</p>
                              <p className="text-xs text-muted-foreground">
                                Ключ обновлён {new Date(site.publicApiKeyGeneratedAt).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant={isActive ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setSelectedSiteId(site.id)}
                              >
                                {isActive ? "Используется в примере" : "Использовать в примере"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => rotateApiKey.mutate(site.id)}
                                disabled={rotateApiKey.isPending && rotateApiKey.variables === site.id}
                              >
                                {rotateApiKey.isPending && rotateApiKey.variables === site.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                Обновить ключ
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <span className="text-xs uppercase text-muted-foreground">ID коллекции</span>
                              <div className="flex items-center gap-2">
                                <code className="bg-muted rounded px-2 py-1 text-sm break-all flex-1">
                                  {site.publicId}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(site.publicId, "ID коллекции")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <span className="text-xs uppercase text-muted-foreground">API-ключ</span>
                              <div className="flex items-center gap-2">
                                <code className="bg-muted rounded px-2 py-1 text-sm break-all flex-1">
                                  {site.publicApiKey}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(site.publicApiKey, "API-ключ")}
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <span className="text-xs uppercase text-muted-foreground">Endpoint</span>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted rounded px-2 py-1 text-sm break-all flex-1">{endpoint}</code>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(endpoint, "Endpoint")}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Пример запроса</CardTitle>
                <CardDescription>
                  Отправьте POST-запрос с заголовком <code>X-API-Key</code> и JSON-телом с параметрами поиска.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-semibold">cURL</h4>
                  <div className="relative rounded-lg bg-muted p-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() =>
                        copyToClipboard(
                          `curl -X POST '${publicSearchEndpoint}' \\\n+  -H 'Content-Type: application/json' \\\n+  -H 'X-API-Key: ${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}' \\\n+  -d '{\\n    "query": "маркетинг",\\n    "hitsPerPage": 5,\\n    "page": 0\\n  }'`,
                          "cURL"
                        )
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <pre className="text-xs leading-5 whitespace-pre-wrap break-words">
{`curl -X POST '${publicSearchEndpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}' \\
  -d '{
    "query": "маркетинг",
    "hitsPerPage": 5,
    "page": 0
  }'`}
                    </pre>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-semibold">Пример ответа</h4>
                  <ScrollArea className="h-64 rounded-lg bg-muted p-4">
                    <pre className="text-xs leading-5 whitespace-pre-wrap break-words">
{`{
  "hits": [
    {
      "objectID": "page-id",
      "url": "https://example.com/page",
      "title": "Заголовок страницы",
      "excerpt": "Краткий фрагмент с совпадениями…",
      "_highlightResult": {
        "title": { "value": "<mark>Поиск</mark> по сайту", "matchLevel": "partial" }
      }
    }
  ],
  "nbHits": 12,
  "page": 0,
  "nbPages": 2,
  "hitsPerPage": 5,
  "query": "маркетинг",
  "params": "query=маркетинг&hitsPerPage=5&page=0"
}`}
                    </pre>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Векторный поиск по коллекциям
                </CardTitle>
                <CardDescription>
                  Используйте заранее загруженные эмбеддинги, чтобы находить релевантные документы по близости вектора запроса.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Эндпоинт принимает массив чисел такой же размерности, как вектор в выбранной коллекции Qdrant. Параметр
                    <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">limit</code> играет роль <strong>topK</strong> — количество ближайших документов, которые нужно вернуть.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Название коллекции можно посмотреть в разделе «Векторный поиск → Коллекции». По умолчанию пример использует
                    идентификатор выбранного сайта: <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">{vectorExampleCollection}</code>.
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">POST</Badge>
                    <code className="text-sm break-all">/api/vector/collections/{'{collectionName}'}/search</code>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-semibold">Тело запроса</h4>
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-1 gap-2 font-medium sm:grid-cols-4">
                      <span>Поле</span>
                      <span>Тип</span>
                      <span>Обязательное</span>
                      <span>Описание</span>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <code>vector</code>
                      <span>number[]</span>
                      <Badge variant="destructive" className="w-fit">Да</Badge>
                      <span>Вектор запроса (длина должна совпадать с размерностью коллекции).</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <code>limit</code>
                      <span>number</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>TopK — количество ближайших результатов. По умолчанию 10.</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <code>offset</code>
                      <span>number</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>Пропустить первые N результатов.</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <code>filter</code>
                      <span>Qdrant filter</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>Ограничение по payload (например, конкретный сайт, язык или тег).</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <code>withPayload</code>
                      <span>boolean | object</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>Управляет возвратом payload в ответе.</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <code>withVector</code>
                      <span>boolean</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>Вернуть ли исходные векторы документов.</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-2">Пример запроса</h4>
                  <div className="relative rounded-lg bg-muted p-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() =>
                        copyToClipboard(
                          `POST ${vectorSearchEndpoint}\nContent-Type: application/json\n\n{\n  "vector": [0.12, -0.03, 0.87, ...],\n  "limit": 5,\n  "filter": {\n    "must": [\n      {\n        "key": "metadata.siteId",\n        "match": { "value": "${selectedSite?.id ?? "site-123"}" }\n      }\n    ]\n  },\n  "withPayload": true\n}`,
                          "Векторный поиск"
                        )
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <pre className="text-sm whitespace-pre-wrap break-words">
{`POST ${vectorSearchEndpoint}
Content-Type: application/json

{
  "vector": [0.12, -0.03, 0.87, ...],
  "limit": 5,
  "filter": {
    "must": [
      {
        "key": "metadata.siteId",
        "match": { "value": "${selectedSite?.id ?? "site-123"}" }
      }
    ]
  },
  "withPayload": true
}`}
                    </pre>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Пример ответа</h4>
                  <div className="relative rounded-lg bg-muted p-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() =>
                        copyToClipboard(
                          `{
  "results": [
    {
      "id": "point-001",
      "score": 0.842,
      "payload": {
        "title": "FAQ по доставке",
        "url": "https://example.com/faq/delivery",
        "metadata": {
          "siteId": "${selectedSite?.id ?? "site-123"}",
          "language": "ru"
        }
      }
    }
  ]
}`,
                          "Ответ векторного поиска"
                        )
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <pre className="text-sm whitespace-pre-wrap break-words">
{`{
  "results": [
    {
      "id": "point-001",
      "score": 0.842,
      "payload": {
        "title": "FAQ по доставке",
        "url": "https://example.com/faq/delivery",
        "metadata": {
          "siteId": "${selectedSite?.id ?? "site-123"}",
          "language": "ru"
        }
      }
    }
  ]
}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeSection === "tilda" && (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-3xl font-bold mb-2 flex items-center gap-2">
                  <Globe className="h-8 w-8" />
                  API для интеграции с Тильдой
                </h2>
                <p className="text-lg text-muted-foreground">
                  Подключите поисковый движок к вашему сайту на Тильде для обеспечения быстрого и релевантного поиска
                </p>
              </div>
              <div className="w-full lg:w-80 space-y-2">
                <span className="text-sm font-medium text-muted-foreground">Коллекция для примеров</span>
                {sites.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Добавьте коллекцию, чтобы получить API-ключ и идентификатор.
                  </div>
                ) : (
                  <Select value={selectedSite?.id ?? ""} onValueChange={(value) => setSelectedSiteId(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите коллекцию" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="search">Поиск</TabsTrigger>
          <TabsTrigger value="integration">Интеграция</TabsTrigger>
          <TabsTrigger value="examples">Примеры</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Базовая информация
              </CardTitle>
              <CardDescription>
                Основные детали API поискового движка
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold mb-2">Базовый URL</h4>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
                      {currentDomain}/api
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(`${currentDomain}/api`)}
                      data-testid="button-copy-base-url"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Формат ответов</h4>
                  <Badge variant="secondary">JSON</Badge>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h4 className="font-semibold mb-2">Особенности</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Полнотекстовый поиск по содержимому сайта</li>
                  <li>Автоматическая индексация страниц</li>
                  <li>Поддержка русского языка</li>
                  <li>Быстрые ответы (обычно &lt; 100ms)</li>
                  <li>Поиск по заголовкам, содержимому и мета-описаниям</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Поиск по сайту
              </CardTitle>
              <CardDescription>
                Публичный endpoint для выполнения поиска по выбранной коллекции
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Badge variant="default">POST</Badge>
                  <code className="text-sm break-all">
                    /api/public/collections/{selectedSite ? selectedSite.publicId : ":collectionId"}/search
                  </code>
                </div>
                <p className="text-sm text-muted-foreground">
                  Выполняет поиск по страницам выбранной коллекции. Передайте API-ключ в заголовке <code>X-API-Key</code>.
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold">JSON-тело запроса</h4>
                <div className="rounded-lg border p-4">
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
                    <div className="font-mono font-semibold">query</div>
                    <div><Badge variant="destructive">обязательный</Badge></div>
                    <div>string</div>
                    <div>Поисковый запрос</div>
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
                    <div className="font-mono font-semibold">hitsPerPage</div>
                    <div><Badge variant="secondary">необязательный</Badge></div>
                    <div>number</div>
                    <div>Количество результатов (по умолчанию: 10)</div>
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
                    <div className="font-mono font-semibold">page</div>
                    <div><Badge variant="secondary">необязательный</Badge></div>
                    <div>number</div>
                    <div>Номер страницы (счёт начинается с 0)</div>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Пример запроса</h4>
                <div className="relative rounded-lg bg-muted p-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() =>
                      copyToClipboard(
                        `fetch('${publicSearchEndpoint}', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'X-API-Key': '${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}'\n  },\n  body: JSON.stringify({\n    query: 'контакты',\n    hitsPerPage: 5,\n    page: 0\n  })\n}).then((res) => res.json());`,
                        "Пример запроса",
                      )
                    }
                    data-testid="button-copy-search-example"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <pre className="text-sm whitespace-pre-wrap break-words">
{`fetch('${publicSearchEndpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}'
  },
  body: JSON.stringify({
    query: 'контакты',
    hitsPerPage: 5,
    page: 0
  })
}).then((res) => res.json());`}
                  </pre>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Пример ответа</h4>
                <ScrollArea className="h-64 rounded-lg bg-muted p-4">
                  <pre className="text-sm whitespace-pre-wrap break-words">
{`{
  "hits": [
    {
      "objectID": "page-123",
      "url": "https://mysite.tilda.ws/contacts",
      "title": "Контакты - Наша компания",
      "excerpt": "Свяжитесь с нами любым удобным способом...",
      "_highlightResult": {
        "title": {
          "value": "<mark>Контакты</mark> - Наша компания",
          "matchLevel": "partial"
        }
      }
    }
  ],
  "nbHits": 1,
  "page": 0,
  "hitsPerPage": 5,
  "nbPages": 1,
  "query": "контакты",
  "params": "query=контакты&hitsPerPage=5&page=0"
}`}
                  </pre>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integration" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Интеграция с Тильдой</CardTitle>
              <CardDescription>
                Пошаговое руководство по подключению поиска на сайт
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h4 className="font-semibold text-lg">Zero блок с современным поисковым виджетом</h4>
                <p className="text-sm text-muted-foreground">
                  Скопируйте и вставьте HTML, CSS и JavaScript ниже в один блок T123 (HTML) на Тильде. Код
                  адаптирован под Zero блок и содержит все необходимые обработчики, чтобы поиск работал стабильно.
                </p>
                <p className="text-sm text-muted-foreground">
                  В примерах ниже автоматически подставлены endpoint и API-ключ выбранной коллекции:
                  {" "}
                  <code className="bg-muted px-2 py-1 rounded text-xs">{publicSearchEndpoint}</code>
                </p>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Шаг 1: HTML структура</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Разместите HTML-каркас виджета внутри Zero блока. Он отвечает за поля ввода, кнопку и зоны вывода
                  результатов.
                </p>
                <div className="relative">
                  <ScrollArea className="h-80 rounded-lg bg-muted p-4">
                    <pre className="text-sm whitespace-pre-wrap break-words">
                      <code>{zeroBlockHtml}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockHtml)}
                    data-testid="button-copy-html"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 2: Стилизация (CSS)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Добавьте стили внутри того же блока. Они отвечают за адаптивность, подсветку и общий вид результата.
                </p>
                <div className="relative">
                  <ScrollArea className="h-80 rounded-lg bg-muted p-4">
                    <pre className="text-sm whitespace-pre-wrap break-words">
                      <code>{zeroBlockCss}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockCss)}
                    data-testid="button-copy-css"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 3: Логика поиска (JavaScript)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Скрипт добавляет живой поиск с задержкой, подсветкой найденных фраз и обработкой ошибок. Вставьте код
                  в тот же блок сразу после HTML и CSS.
                </p>
                <div className="relative">
                  <ScrollArea className="h-[420px] rounded-lg bg-muted p-4">
                    <pre className="text-sm whitespace-pre-wrap break-words">
                      <code>{zeroBlockJs}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockJs)}
                    data-testid="button-copy-javascript"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 4: Полный блок одним куском</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Если удобнее, скопируйте готовый комплект из HTML, CSS и JavaScript. Вставьте код целиком в Zero блок —
                  он сразу начнёт работать.
                </p>
                <div className="relative">
                  <ScrollArea className="h-[500px] rounded-lg bg-muted p-4">
                    <pre className="text-sm whitespace-pre-wrap break-words">
                      <code>{zeroBlockFull}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockFull)}
                    data-testid="button-copy-full-widget"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Особенности и улучшения</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Живой поиск с задержкой 300 мс и отменой предыдущих запросов.</li>
                  <li>Индикатор загрузки, информативные сообщения об ошибках и статистика найденных страниц.</li>
                  <li>Подсветка совпадений и аккуратные карточки результатов в стиле современного поиска.</li>
                  <li>Адаптивная вёрстка, корректно отображается на мобильных устройствах.</li>
                  <li>Скрипт автоматически использует endpoint {publicSearchEndpoint} и готов к работе сразу после вставки.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="examples" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Тестирование API</CardTitle>
                <CardDescription>
                  Проверьте работу поиска прямо сейчас
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Попробуйте эти запросы:</h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="button-test-search-1"
                          onClick={() =>
                            copyToClipboard(
                              `curl -X POST '${publicSearchEndpoint}' \\n+  -H 'Content-Type: application/json' \\n+  -H 'X-API-Key: ${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}' \\n+  -d '{"query": "поиск", "hitsPerPage": 5}'`,
                              "curl-запрос",
                            )
                          }
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          поиск (скопировать curl)
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="button-test-search-2"
                          onClick={() =>
                            copyToClipboard(
                              `curl -X POST '${publicSearchEndpoint}' \\n+  -H 'Content-Type: application/json' \\n+  -H 'X-API-Key: ${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}' \\n+  -d '{"query": "страница", "hitsPerPage": 5}'`,
                              "curl-запрос",
                            )
                          }
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          страница (скопировать curl)
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="button-test-search-3"
                          onClick={() =>
                            copyToClipboard(
                              `curl -X POST '${publicSearchEndpoint}' \\n+  -H 'Content-Type: application/json' \\n+  -H 'X-API-Key: ${selectedSite?.publicApiKey ?? "YOUR_API_KEY"}' \\n+  -d '{"query": "тест", "hitsPerPage": 3}'`,
                              "curl-запрос",
                            )
                          }
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          тест (лимит 3, скопировать curl)
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Полезные ссылки</CardTitle>
                <CardDescription>
                  Дополнительные ресурсы для интеграции
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm">Документация Тильды</h4>
                    <Button variant="ghost" className="p-0 h-auto" asChild>
                      <a href="https://help.tilda.cc/html" target="_blank">
                        help.tilda.cc/html
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Добавление своего кода</h4>
                    <Button variant="ghost" className="p-0 h-auto" asChild>
                      <a href="https://help.tilda.cc/code" target="_blank">
                        help.tilda.cc/code
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Блок T123 (HTML)</h4>
                    <Button variant="ghost" className="p-0 h-auto" asChild>
                      <a href="https://help.tilda.cc/t123" target="_blank">
                        help.tilda.cc/t123
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}

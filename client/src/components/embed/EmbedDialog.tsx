import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WorkspaceEmbedKey, WorkspaceEmbedKeyDomain } from "@shared/schema";

interface EmbedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  collection: string;
  embeddingProviderId: string;
  llmProviderId: string;
  llmModel: string;
  limit: number;
  contextLimit: number;
  responseFormat: "text" | "markdown" | "html";
}

interface EmbedKeyResponse {
  key: WorkspaceEmbedKey;
  domains: WorkspaceEmbedKeyDomain[];
}

function buildDefaultBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "https://your-service.example";
}

function buildSnippet(config: {
  baseUrl: string;
  workspaceId: string;
  knowledgeBaseId: string;
  collection: string;
  publicKey: string;
  embeddingProviderId: string;
  llmProviderId: string;
  llmModel: string;
  limit: number;
  contextLimit: number;
  responseFormat: "text" | "markdown" | "html";
  mode: "inline" | "modal";
  theme: "light" | "dark" | "system";
  language: "ru" | "en";
}): string {
  const sanitizedBaseUrl = config.baseUrl.replace(/\/?$/, "");
  const embedConfig = {
    baseUrl: sanitizedBaseUrl,
    apiKey: config.publicKey,
    workspaceId: config.workspaceId,
    knowledgeBaseId: config.knowledgeBaseId,
    collection: config.collection,
    embeddingProviderId: config.embeddingProviderId,
    llmProviderId: config.llmProviderId,
    llmModel: config.llmModel,
    limit: config.limit,
    contextLimit: config.contextLimit,
    responseFormat: config.responseFormat,
    mode: config.mode,
    theme: config.theme,
    language: config.language,
  } as const;

  const serializedConfig = JSON.stringify(embedConfig, null, 2);

  return `<div id="kms-search-embed"></div>
<script>
(function(){
  if (window.__kmsEmbedLoaded) {
    console.warn("Виджет поиска уже инициализирован");
    return;
  }
  window.__kmsEmbedLoaded = true;
  const CONFIG = ${serializedConfig.replace(/<\//g, "<\\/")};
  const STRINGS = {
    ru: {
      placeholder: "Спросите базу знаний…",
      ask: "Спросить",
      loading: "Готовим ответ…",
      sources: "Источники",
      suggestion: "Перейти",
      close: "Закрыть",
      open: "Открыть поиск",
      error: "Не удалось получить ответ. Попробуйте ещё раз.",
      noResults: "Нет подходящих подсказок",
    },
    en: {
      placeholder: "Ask the knowledge base…",
      ask: "Ask",
      loading: "Preparing an answer…",
      sources: "Sources",
      suggestion: "Open",
      close: "Close",
      open: "Open search",
      error: "Failed to get response. Please try again.",
      noResults: "No suggestions",
    }
  };
  const TEXT = STRINGS[CONFIG.language] || STRINGS.ru;
  const containerId = "kms-search-embed";
  let root = document.getElementById(containerId);
  if (!root) {
    console.error("Контейнер виджета не найден", containerId);
    return;
  }

  const style = document.createElement("style");
  style.textContent = \`
    .kms-embed-wrapper { font-family: 'Inter', system-ui, sans-serif; color: #0f172a; }
    .kms-embed-wrapper[data-theme='dark'] { color: #e2e8f0; }
    .kms-embed-surface { border: 1px solid rgba(15,23,42,0.1); border-radius: 16px; padding: 16px; background: rgba(255,255,255,0.95); box-shadow: 0 18px 60px rgba(15, 23, 42, 0.18); }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-surface { background: rgba(15,23,42,0.9); border-color: rgba(226,232,240,0.12); box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32); }
    .kms-embed-input { width: 100%; border: 1px solid rgba(148,163,184,0.5); border-radius: 12px; padding: 12px 16px; font-size: 15px; background: rgba(255,255,255,0.9); transition: border-color 0.2s ease, box-shadow 0.2s ease; }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-input { background: rgba(15,23,42,0.6); border-color: rgba(148,163,184,0.25); color: inherit; }
    .kms-embed-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
    .kms-embed-suggestions { margin-top: 12px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.25); overflow: hidden; }
    .kms-embed-suggestion { padding: 12px 14px; background: rgba(148,163,184,0.1); cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
    .kms-embed-suggestion:hover { background: rgba(99,102,241,0.12); }
    .kms-embed-suggestion-title { font-weight: 600; font-size: 14px; }
    .kms-embed-suggestion-snippet { font-size: 13px; color: rgba(15,23,42,0.7); }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-suggestion-snippet { color: rgba(226,232,240,0.7); }
    .kms-embed-result { margin-top: 16px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.25); padding: 16px; background: rgba(255,255,255,0.85); }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-result { background: rgba(15,23,42,0.7); }
    .kms-embed-answer { white-space: pre-wrap; font-size: 15px; line-height: 1.6; }
    .kms-embed-sources { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
    .kms-embed-source-entry { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .kms-embed-source-entry + .kms-embed-source-entry { padding-top: 4px; border-top: 1px solid rgba(148,163,184,0.2); }
    .kms-embed-source { font-size: 13px; color: rgba(37,99,235,0.95); text-decoration: none; font-weight: 500; }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-source { color: rgba(165,180,252,0.95); }
    .kms-embed-source-snippet { font-size: 12px; color: rgba(15,23,42,0.7); line-height: 1.5; }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-source-snippet { color: rgba(226,232,240,0.75); }
    .kms-embed-error { margin-top: 12px; font-size: 13px; color: #dc2626; }
    .kms-embed-loader { margin-top: 12px; font-size: 13px; color: rgba(15,23,42,0.75); }
    .kms-embed-wrapper[data-theme='dark'] .kms-embed-loader { color: rgba(226,232,240,0.75); }
    .kms-embed-modal-button { border-radius: 9999px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 18px; font-weight: 600; border: none; cursor: pointer; box-shadow: 0 14px 40px rgba(79,70,229,0.35); }
    .kms-embed-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.55); display: flex; align-items: center; justify-content: center; z-index: 2147483600; }
    .kms-embed-modal-surface { width: min(540px, calc(100vw - 32px)); }
  \`;
  document.head.appendChild(style);

  function resolveTheme() {
    if (CONFIG.theme === "system" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return CONFIG.theme;
  }

  function renderInline(container) {
    container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "kms-embed-wrapper";
    wrapper.dataset.theme = resolveTheme();

    const surface = document.createElement("div");
    surface.className = "kms-embed-surface";

    const input = document.createElement("input");
    input.className = "kms-embed-input";
    input.type = "search";
    input.placeholder = TEXT.placeholder;

    const suggestions = document.createElement("div");
    suggestions.className = "kms-embed-suggestions";
    suggestions.style.display = "none";

    const loader = document.createElement("div");
    loader.className = "kms-embed-loader";
    loader.style.display = "none";
    loader.textContent = TEXT.loading;

    const error = document.createElement("div");
    error.className = "kms-embed-error";
    error.style.display = "none";

    const result = document.createElement("div");
    result.className = "kms-embed-result";
    result.style.display = "none";

    const answer = document.createElement("div");
    answer.className = "kms-embed-answer";

    const sources = document.createElement("div");
    sources.className = "kms-embed-sources";

    result.appendChild(answer);
    result.appendChild(sources);

    surface.appendChild(input);
    surface.appendChild(suggestions);
    surface.appendChild(loader);
    surface.appendChild(error);
    surface.appendChild(result);
    wrapper.appendChild(surface);
    container.appendChild(wrapper);

    let debounceTimer = null;

    function renderSuggestions(items) {
      suggestions.innerHTML = "";
      if (!items.length) {
        suggestions.style.display = "none";
        return;
      }

      items.forEach((item) => {
        const entry = document.createElement("div");
        entry.className = "kms-embed-suggestion";
        const title = document.createElement("div");
        title.className = "kms-embed-suggestion-title";
        title.textContent = item.section_title || item.doc_title || TEXT.suggestion;
        const snippet = document.createElement("div");
        snippet.className = "kms-embed-suggestion-snippet";
        snippet.textContent = item.snippet || TEXT.noResults;
        entry.appendChild(title);
        entry.appendChild(snippet);
        entry.addEventListener("click", () => {
          input.value = item.section_title || item.doc_title || item.snippet || input.value;
          suggestions.style.display = "none";
          performSearch(input.value);
        });
        suggestions.appendChild(entry);
      });

      suggestions.style.display = "block";
    }

    async function requestSuggest(query) {
      const url = new URL(CONFIG.baseUrl + "/api/public/embed/suggest");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", String(CONFIG.limit));
      url.searchParams.set("workspace_id", CONFIG.workspaceId);
      url.searchParams.set("kb_id", CONFIG.knowledgeBaseId);
      url.searchParams.set("collection", CONFIG.collection);
      const response = await fetch(url.toString(), {
        headers: {
          "X-API-Key": CONFIG.apiKey,
          "X-Embed-Origin": window.location.hostname,
        },
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(\`Suggest failed with \${response.status}\`);
      }
      return await response.json();
    }

    async function performSearch(question) {
      const trimmed = (question || "").trim();
      if (!trimmed) {
        return;
      }
      loader.style.display = "block";
      error.style.display = "none";
      result.style.display = "none";
      suggestions.style.display = "none";
      try {
        const response = await fetch(CONFIG.baseUrl + "/api/public/collections/search/rag", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-API-Key": CONFIG.apiKey,
            "X-Embed-Origin": window.location.hostname,
          },
          body: JSON.stringify({
            workspace_id: CONFIG.workspaceId,
            collection: CONFIG.collection,
            query: trimmed,
            embeddingProviderId: CONFIG.embeddingProviderId,
            llmProviderId: CONFIG.llmProviderId,
            llmModel: CONFIG.llmModel,
            limit: CONFIG.limit,
            contextLimit: CONFIG.contextLimit,
            includeContext: true,
            includeQueryVector: false,
            responseFormat: CONFIG.responseFormat,
          }),
        });

        if (!response.ok) {
          throw new Error(\`RAG failed with \${response.status}\`);
        }

        const data = await response.json();
        loader.style.display = "none";
        const answerText = typeof data.answer === "string" ? data.answer.trim() : "";
        answer.textContent = answerText;
        sources.innerHTML = "";
        let hasSources = false;
        if (Array.isArray(data.sources)) {
          data.sources.forEach((source) => {
            if (!source || typeof source.url !== "string") {
              return;
            }
            const rawUrl = source.url.trim();
            if (!rawUrl) {
              return;
            }
            const entry = document.createElement("div");
            entry.className = "kms-embed-source-entry";
            const link = document.createElement("a");
            link.className = "kms-embed-source";
            link.href = rawUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            const titleValue =
              typeof source.title === "string" && source.title.trim()
                ? source.title.trim()
                : rawUrl;
            link.textContent = titleValue;
            entry.appendChild(link);
            if (typeof source.snippet === "string" && source.snippet.trim()) {
              const snippet = document.createElement("div");
              snippet.className = "kms-embed-source-snippet";
              snippet.textContent = source.snippet.trim();
              entry.appendChild(snippet);
            }
            sources.appendChild(entry);
            hasSources = true;
          });
        }
        sources.style.display = hasSources ? "flex" : "none";
        result.style.display = answerText || hasSources ? "block" : "none";
      } catch (err) {
        loader.style.display = "none";
        error.textContent = TEXT.error;
        error.style.display = "block";
        console.error(err);
      }
    }

    input.addEventListener("input", (event) => {
      const value = (event.target.value || "").trim();
      if (!value) {
        suggestions.style.display = "none";
        return;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        try {
          const payload = await requestSuggest(value);
          if (Array.isArray(payload.sections) && payload.sections.length > 0) {
            renderSuggestions(payload.sections);
          } else {
            suggestions.style.display = "none";
          }
        } catch (err) {
          console.error(err);
          suggestions.style.display = "none";
        }
      }, 250);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        performSearch(input.value);
      }
    });
  }

  function renderModal(container) {
    container.innerHTML = "";
    const button = document.createElement("button");
    button.className = "kms-embed-modal-button";
    button.type = "button";
    button.textContent = TEXT.open;
    container.appendChild(button);

    button.addEventListener("click", () => {
      const overlay = document.createElement("div");
      overlay.className = "kms-embed-modal-overlay";
      const modalSurface = document.createElement("div");
      modalSurface.className = "kms-embed-surface kms-embed-modal-surface";
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.style.cssText = "margin-left:auto; display:block; background:none; border:none; color:inherit; font-size:13px; cursor:pointer;";
      closeButton.textContent = TEXT.close;
      const content = document.createElement("div");
      const innerContainer = document.createElement("div");
      modalSurface.appendChild(closeButton);
      modalSurface.appendChild(content);
      overlay.appendChild(modalSurface);
      document.body.appendChild(overlay);
      closeButton.addEventListener("click", () => {
        overlay.remove();
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
      renderInline(content);
    });
  }

  if (CONFIG.mode === "modal") {
    renderModal(root);
  } else {
    renderInline(root);
  }
})();
<\/script>`;
}

export function EmbedDialog({
  open,
  onOpenChange,
  workspaceId,
  knowledgeBaseId,
  knowledgeBaseName,
  collection,
  embeddingProviderId,
  llmProviderId,
  llmModel,
  limit,
  contextLimit,
  responseFormat,
}: EmbedDialogProps) {
  const { toast } = useToast();
  const displayKnowledgeBaseName = knowledgeBaseName || "выбранная база";
  const [baseUrl, setBaseUrl] = useState(buildDefaultBaseUrl());
  const [mode, setMode] = useState<"inline" | "modal">("inline");
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [domainInput, setDomainInput] = useState("");
  const [embedKey, setEmbedKey] = useState<WorkspaceEmbedKey | null>(null);
  const [domains, setDomains] = useState<WorkspaceEmbedKeyDomain[]>([]);

  const ensureKeyMutation = useMutation(async () => {
    const response = await apiRequest("POST", "/api/embed/keys", {
      collection,
      knowledgeBaseId,
    });
    return (await response.json()) as EmbedKeyResponse;
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    ensureKeyMutation.mutate(undefined, {
      onSuccess: (data) => {
        setEmbedKey(data.key);
        setDomains(data.domains);
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : "Не удалось получить публичный ключ";
        toast({ title: "Ошибка", description: message, variant: "destructive" });
        onOpenChange(false);
      },
    });
  }, [open, knowledgeBaseId, collection, toast, onOpenChange, ensureKeyMutation]);

  const addDomainMutation = useMutation(
    async (domain: string) => {
      const response = await apiRequest("POST", `/api/embed/keys/${embedKey?.id ?? ""}/domains`, {
        domain,
      });
      return (await response.json()) as WorkspaceEmbedKeyDomain;
    },
    {
      onSuccess: (domain) => {
        setDomains((prev) => [...prev, domain]);
        setDomainInput("");
        toast({ title: "Домен добавлен", description: `Домен ${domain.domain} успешно добавлен в allowlist.` });
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : "Не удалось добавить домен";
        toast({ title: "Ошибка", description: message, variant: "destructive" });
      },
    },
  );

  const removeDomainMutation = useMutation(
    async (domainId: string) => {
      await apiRequest("DELETE", `/api/embed/keys/${embedKey?.id ?? ""}/domains/${domainId}`);
      return domainId;
    },
    {
      onSuccess: (domainId) => {
        setDomains((prev) => prev.filter((domain) => domain.id !== domainId));
        toast({ title: "Домен удалён", description: "Домен убран из allowlist." });
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : "Не удалось удалить домен";
        toast({ title: "Ошибка", description: message, variant: "destructive" });
      },
    },
  );

  const snippet = useMemo(() => {
    if (!embedKey) {
      return "";
    }

    return buildSnippet({
      baseUrl,
      workspaceId,
      knowledgeBaseId,
      collection,
      publicKey: embedKey.publicKey,
      embeddingProviderId,
      llmProviderId,
      llmModel,
      limit,
      contextLimit,
      responseFormat,
      mode,
      theme,
      language,
    });
  }, [
    embedKey,
    baseUrl,
    workspaceId,
    knowledgeBaseId,
    collection,
    embeddingProviderId,
    llmProviderId,
    llmModel,
    limit,
    contextLimit,
    responseFormat,
    mode,
    theme,
    language,
  ]);

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast({ title: "Сниппет скопирован", description: "Вставьте код на своём сайте." });
    } catch (error) {
      toast({ title: "Не удалось скопировать", description: String(error), variant: "destructive" });
    }
  };

  const handleAddDomain = () => {
    const normalized = (domainInput || "").trim();
    if (!normalized || !embedKey) {
      return;
    }
    addDomainMutation.mutate(normalized);
  };

  const currentTheme = useMemo(() => {
    if (theme === "system") {
      if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }
      return "light";
    }
    return theme;
  }, [theme]);

  const isLoading = ensureKeyMutation.isPending || !embedKey;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Встраиваемый поиск</DialogTitle>
          <DialogDescription>
            Сформируйте код виджета для базы знаний «{displayKnowledgeBaseName}». Настройте домены и внешний вид перед
            копированием.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Подготавливаем публичный ключ…
          </div>
        ) : (
          <ScrollArea className="max-h-[70vh] pr-2">
            <div className="space-y-8 pb-4">
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Публичный ключ</Label>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1 text-sm">{embedKey?.publicKey}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(embedKey?.publicKey ?? "");
                          toast({ title: "Ключ скопирован", description: "Используйте его в сниппете." });
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Копировать ключ
                      </Button>
                    </div>
                  </div>
                  <Badge variant="outline">workspace: {workspaceId.slice(0, 6)}…</Badge>
                  <Badge variant="outline">collection: {collection}</Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="embed-base-url">Базовый URL сервера</Label>
                    <Input
                      id="embed-base-url"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://app.example.com"
                    />
                    <p className="text-xs text-muted-foreground">
                      Используется для запросов к публичным эндпоинтам. Укажите домен, где доступна админ-панель.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Режим отображения</Label>
                    <Tabs value={mode} onValueChange={(value) => setMode(value as "inline" | "modal") }>
                      <TabsList className="grid grid-cols-2">
                        <TabsTrigger value="inline">Встроенный</TabsTrigger>
                        <TabsTrigger value="modal">Кнопка + модальное окно</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <Label className="mt-4 block">Тема</Label>
                    <Tabs value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
                      <TabsList className="grid grid-cols-3">
                        <TabsTrigger value="light">Светлая</TabsTrigger>
                        <TabsTrigger value="dark">Тёмная</TabsTrigger>
                        <TabsTrigger value="system">Системная</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <Label className="mt-4 block">Язык интерфейса</Label>
                    <Tabs value={language} onValueChange={(value) => setLanguage(value as typeof language)}>
                      <TabsList className="grid grid-cols-2">
                        <TabsTrigger value="ru">Русский</TabsTrigger>
                        <TabsTrigger value="en">English</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="space-y-3">
                <Label>Разрешённые домены</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {domains.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Пока нет доменов. Добавьте домен сайта (например, <code>example.com</code>), чтобы запросы проходили проверку.
                    </p>
                  ) : (
                    domains.map((domain) => (
                      <Badge key={domain.id} variant="secondary" className="flex items-center gap-2">
                        {domain.domain}
                        <button
                          type="button"
                          onClick={() => removeDomainMutation.mutate(domain.id)}
                          className="inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={domainInput}
                    onChange={(event) => setDomainInput(event.target.value)}
                    placeholder="example.com"
                    className="max-w-xs"
                  />
                  <Button type="button" onClick={handleAddDomain} disabled={!domainInput.trim() || addDomainMutation.isPending}>
                    {addDomainMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Добавить домен
                  </Button>
                </div>
              </section>

              <Separator />

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Сниппет для вставки</Label>
                    <p className="text-xs text-muted-foreground">
                      Вставьте код в HTML-блок сайта (например, Tilda или любой другой конструктор).
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleCopySnippet}>
                    <Copy className="mr-2 h-4 w-4" /> Скопировать сниппет
                  </Button>
                </div>
                <Textarea value={snippet} readOnly className="h-64 font-mono text-xs" />
                <p className="text-xs text-muted-foreground">
                  При необходимости обновите параметры (провайдеры, лимиты) в песочнице и сформируйте код заново.
                </p>
              </section>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

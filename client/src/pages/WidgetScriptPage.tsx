import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Info, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Site, PublicEmbeddingProvider, PublicLlmProvider, LlmModelOption } from "@shared/schema";
import type { SessionResponse } from "@/types/session";

const buildScriptConfig = (
  baseUrl: string,
  site: Site | undefined,
  embeddingProvider: PublicEmbeddingProvider | undefined,
  llmOption: { provider: PublicLlmProvider; model: LlmModelOption } | undefined,
  limit: number,
  contextLimit: number,
  collectionName: string | null,
) => {
  const sanitizedBaseUrl = baseUrl.replace(/\/$/, "");
  return {
    baseUrl: sanitizedBaseUrl || "https://your-service.example",
    publicId: site?.publicId ?? "SITE_PUBLIC_ID",
    apiKey: site?.publicApiKey ?? "PUBLIC_API_KEY",
    collectionName: collectionName ?? "COLLECTION_NAME",
    embeddingProviderId: embeddingProvider?.id ?? "EMBEDDING_PROVIDER_ID",
    llmProviderId: llmOption?.provider.id ?? "LLM_PROVIDER_ID",
    llmModel: llmOption?.model.value ?? "LLM_MODEL",
    limit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 5,
    contextLimit:
      Number.isFinite(contextLimit) && contextLimit > 0 ? Math.round(contextLimit) : Math.min(5, limit || 5),
  } as const;
};

const sanitizeCollectionSegment = (value: string) => {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
};

const buildWorkspaceScopedCollectionName = (workspaceId: string, projectId: string, providerId: string) => {
  return `ws_${sanitizeCollectionSegment(workspaceId)}__proj_${sanitizeCollectionSegment(projectId)}__coll_${sanitizeCollectionSegment(
    providerId,
  )}`;
};

const buildCollectionName = (
  workspaceId: string | undefined,
  site: Site | undefined,
  embeddingProvider: PublicEmbeddingProvider | undefined,
) => {
  if (!workspaceId || !embeddingProvider) {
    return null;
  }

  const projectId = site?.id ?? embeddingProvider.id;
  return buildWorkspaceScopedCollectionName(workspaceId, projectId, embeddingProvider.id);
};

const formatProviderLabel = (provider: PublicEmbeddingProvider | PublicLlmProvider | undefined) => {
  if (!provider) {
    return "Не выбрано";
  }

  return provider.isActive ? provider.name : `${provider.name} (отключено)`;
};

const getBaseUrl = () => {
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin;
  }

  return "https://your-service.example";
};

export default function WidgetScriptPage() {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<SessionResponse>(["/api/auth/session"]);
  const workspaceId = session?.workspace.active.id ?? "";
  const { toast } = useToast();

  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ["/api/sites"],
  });

  const { data: embeddingProviders = [] } = useQuery<PublicEmbeddingProvider[]>({
    queryKey: ["/api/embedding/services"],
  });

  const { data: llmProviders = [] } = useQuery<PublicLlmProvider[]>({
    queryKey: ["/api/llm/providers"],
  });

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedEmbeddingId, setSelectedEmbeddingId] = useState<string | null>(null);
  const [selectedLlmKey, setSelectedLlmKey] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(5);
  const [contextLimit, setContextLimit] = useState<number>(3);
  const [copied, setCopied] = useState<string>("");

  const activeSites = sites;
  const activeEmbeddingProviders = useMemo(
    () => embeddingProviders.filter((provider) => provider.isActive),
    [embeddingProviders],
  );
  const activeLlmProviders = useMemo(() => llmProviders.filter((provider) => provider.isActive), [llmProviders]);

  useEffect(() => {
    if (!selectedSiteId && activeSites.length > 0) {
      setSelectedSiteId(activeSites[0].id);
    }
  }, [activeSites, selectedSiteId]);

  useEffect(() => {
    if (!selectedEmbeddingId && activeEmbeddingProviders.length > 0) {
      setSelectedEmbeddingId(activeEmbeddingProviders[0].id);
    }
  }, [activeEmbeddingProviders, selectedEmbeddingId]);

  const llmModelOptions = useMemo(() => {
    const options: Array<{ key: string; provider: PublicLlmProvider; model: LlmModelOption }> = [];

    for (const provider of activeLlmProviders) {
      const models = provider.availableModels && provider.availableModels.length > 0
        ? provider.availableModels
        : [{ label: provider.model, value: provider.model }];

      for (const model of models) {
        options.push({ key: `${provider.id}::${model.value}`, provider, model });
      }
    }

    return options;
  }, [activeLlmProviders]);

  useEffect(() => {
    if (!selectedLlmKey && llmModelOptions.length > 0) {
      setSelectedLlmKey(llmModelOptions[0].key);
    }
  }, [llmModelOptions, selectedLlmKey]);

  const selectedSite = useMemo(() => {
    return activeSites.find((site) => site.id === selectedSiteId) ?? activeSites[0];
  }, [activeSites, selectedSiteId]);

  const selectedEmbeddingProvider = useMemo(() => {
    return activeEmbeddingProviders.find((provider) => provider.id === selectedEmbeddingId) ?? activeEmbeddingProviders[0];
  }, [activeEmbeddingProviders, selectedEmbeddingId]);

  const selectedLlmOption = useMemo(() => {
    return llmModelOptions.find((option) => option.key === selectedLlmKey) ?? llmModelOptions[0] ?? null;
  }, [llmModelOptions, selectedLlmKey]);

  const collectionName = useMemo(
    () => buildCollectionName(workspaceId, selectedSite, selectedEmbeddingProvider),
    [workspaceId, selectedSite, selectedEmbeddingProvider],
  );

  const scriptConfig = useMemo(
    () => buildScriptConfig(getBaseUrl(), selectedSite, selectedEmbeddingProvider, selectedLlmOption ?? undefined, limit, contextLimit, collectionName),
    [selectedSite, selectedEmbeddingProvider, selectedLlmOption, limit, contextLimit, collectionName],
  );

  const widgetCss = `#ai-kms-chat-widget { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; z-index: 2147483600; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
#ai-kms-chat-widget * { box-sizing: border-box; }
#ai-kms-chat-widget .akms-launcher { width: 56px; height: 56px; border-radius: 28px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px; box-shadow: 0 18px 40px rgba(37, 99, 235, 0.35); cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; }
#ai-kms-chat-widget .akms-launcher:hover { transform: translateY(-2px); box-shadow: 0 22px 48px rgba(76, 29, 149, 0.38); }
#ai-kms-chat-widget .akms-panel { width: min(380px, calc(100vw - 32px)); background: var(--akms-surface, #ffffff); color: var(--akms-foreground, #0f172a); border-radius: 20px; box-shadow: 0 32px 70px rgba(15, 23, 42, 0.22); overflow: hidden; display: flex; flex-direction: column; transform: translateY(16px); opacity: 0; pointer-events: none; transition: transform 0.25s ease, opacity 0.25s ease; }
#ai-kms-chat-widget .akms-panel.akms-open { transform: translateY(0); opacity: 1; pointer-events: auto; }
#ai-kms-chat-widget .akms-header { padding: 18px 20px; background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(79, 70, 229, 0.1)); display: flex; align-items: flex-start; gap: 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.14); }
#ai-kms-chat-widget .akms-header-avatar { width: 42px; height: 42px; border-radius: 16px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; }
#ai-kms-chat-widget .akms-header-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
#ai-kms-chat-widget .akms-header-title { font-size: 16px; font-weight: 600; }
#ai-kms-chat-widget .akms-header-subtitle { font-size: 12px; color: rgba(15, 23, 42, 0.65); line-height: 1.4; }
#ai-kms-chat-widget .akms-close { background: rgba(15, 23, 42, 0.06); border: none; border-radius: 10px; width: 32px; height: 32px; cursor: pointer; color: rgba(15, 23, 42, 0.65); transition: background 0.2s ease; }
#ai-kms-chat-widget .akms-close:hover { background: rgba(15, 23, 42, 0.12); }
#ai-kms-chat-widget .akms-body { padding: 16px 20px; flex: 1; overflow-y: auto; max-height: 420px; display: flex; flex-direction: column; gap: 14px; }
#ai-kms-chat-widget .akms-message { display: flex; gap: 10px; align-items: flex-start; }
#ai-kms-chat-widget .akms-message-user { flex-direction: row-reverse; }
#ai-kms-chat-widget .akms-bubble { padding: 12px 14px; border-radius: 14px; background: rgba(37, 99, 235, 0.08); color: rgba(15, 23, 42, 0.92); font-size: 14px; line-height: 1.45; white-space: pre-wrap; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3); max-width: 100%; }
#ai-kms-chat-widget .akms-message-user .akms-bubble { background: linear-gradient(135deg, rgba(37, 99, 235, 0.95), rgba(59, 130, 246, 0.95)); color: #fff; }
#ai-kms-chat-widget .akms-assistant-avatar, #ai-kms-chat-widget .akms-user-avatar { width: 32px; height: 32px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; }
#ai-kms-chat-widget .akms-assistant-avatar { background: rgba(37, 99, 235, 0.12); color: #2563eb; }
#ai-kms-chat-widget .akms-user-avatar { background: rgba(15, 23, 42, 0.08); color: rgba(15, 23, 42, 0.65); }
#ai-kms-chat-widget .akms-footer { border-top: 1px solid rgba(148, 163, 184, 0.14); padding: 14px 18px; background: rgba(15, 23, 42, 0.02); display: flex; flex-direction: column; gap: 10px; }
#ai-kms-chat-widget .akms-textarea-wrapper { display: flex; background: rgba(15, 23, 42, 0.04); border-radius: 14px; border: 1px solid transparent; transition: border-color 0.2s ease, background 0.2s ease; }
#ai-kms-chat-widget .akms-textarea-wrapper:focus-within { border-color: rgba(37, 99, 235, 0.4); background: rgba(37, 99, 235, 0.05); }
#ai-kms-chat-widget textarea { flex: 1; border: none; background: transparent; resize: none; padding: 12px 14px; font-size: 14px; line-height: 1.45; color: inherit; max-height: 140px; }
#ai-kms-chat-widget textarea:focus { outline: none; }
#ai-kms-chat-widget .akms-send { border: none; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; border-radius: 12px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; align-self: flex-end; box-shadow: 0 12px 24px rgba(79, 70, 229, 0.22); transition: box-shadow 0.2s ease, transform 0.2s ease; }
#ai-kms-chat-widget .akms-send:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
#ai-kms-chat-widget .akms-send:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 16px 28px rgba(37, 99, 235, 0.28); }
#ai-kms-chat-widget .akms-status { font-size: 12px; color: rgba(15, 23, 42, 0.58); display: flex; align-items: center; gap: 6px; }
#ai-kms-chat-widget .akms-sources { border-top: 1px solid rgba(148, 163, 184, 0.16); padding: 12px 18px 18px; background: rgba(15, 23, 42, 0.02); display: flex; flex-direction: column; gap: 8px; }
#ai-kms-chat-widget .akms-source-item { background: rgba(148, 163, 184, 0.08); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
#ai-kms-chat-widget .akms-source-title { font-size: 13px; font-weight: 600; color: rgba(15, 23, 42, 0.85); text-decoration: none; }
#ai-kms-chat-widget .akms-source-title:hover { text-decoration: underline; }
#ai-kms-chat-widget .akms-source-snippet { font-size: 12px; color: rgba(15, 23, 42, 0.65); line-height: 1.45; }
#ai-kms-chat-widget .akms-error { background: rgba(220, 38, 38, 0.12); color: rgba(185, 28, 28, 0.95); }
@media (prefers-color-scheme: dark) { #ai-kms-chat-widget { --akms-surface: #0f172a; --akms-foreground: #e2e8f0; } #ai-kms-chat-widget .akms-panel { box-shadow: 0 28px 60px rgba(2, 6, 23, 0.65); } #ai-kms-chat-widget .akms-header-subtitle { color: rgba(226, 232, 240, 0.7); } #ai-kms-chat-widget .akms-close { color: rgba(226, 232, 240, 0.75); } #ai-kms-chat-widget .akms-body { scrollbar-color: rgba(148, 163, 184, 0.3) transparent; } #ai-kms-chat-widget .akms-textarea-wrapper { background: rgba(15, 23, 42, 0.6); } #ai-kms-chat-widget textarea { color: rgba(226, 232, 240, 0.92); } #ai-kms-chat-widget .akms-message-user .akms-bubble { background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(79, 70, 229, 0.95)); } #ai-kms-chat-widget .akms-bubble { background: rgba(37, 99, 235, 0.14); color: rgba(226, 232, 240, 0.92); } #ai-kms-chat-widget .akms-source-item { background: rgba(148, 163, 184, 0.14); } #ai-kms-chat-widget .akms-source-title { color: rgba(226, 232, 240, 0.92); } #ai-kms-chat-widget .akms-source-snippet { color: rgba(148, 163, 184, 0.85); } #ai-kms-chat-widget .akms-status { color: rgba(226, 232, 240, 0.65); } }`;

  const widgetMarkup = `<button type="button" class="akms-launcher" data-ai-kms="toggle" aria-label="Открыть чат">AI</button>
      <div class="akms-panel" data-ai-kms="panel" aria-hidden="true" role="dialog">
        <div class="akms-header">
          <div class="akms-header-avatar">AI</div>
          <div class="akms-header-info">
            <div class="akms-header-title">Виртуальный ассистент</div>
            <div class="akms-header-subtitle">Подключен к вашей базе знаний. Задайте вопрос — подберём ответ в реальном времени.</div>
          </div>
          <button type="button" class="akms-close" data-ai-kms="close" aria-label="Закрыть чат">×</button>
        </div>
        <div class="akms-body" data-ai-kms="messages"></div>
        <div class="akms-sources" data-ai-kms="sources" hidden></div>
        <div class="akms-footer">
          <div class="akms-status" data-ai-kms="status" hidden></div>
          <div class="akms-textarea-wrapper">
            <textarea data-ai-kms="input" rows="1" placeholder="Задайте вопрос…"></textarea>
          </div>
          <button type="button" class="akms-send" data-ai-kms="send">
            <span>Отправить</span>
          </button>
        </div>
      </div>`;

  const scriptTemplate = useMemo(() => {
    const configJson = JSON.stringify(scriptConfig, null, 2);
    return String.raw`(function () {
  if (window.__AI_KMS_CHAT_WIDGET__) {
    return;
  }

  const CONFIG = ${configJson};
  const BASE_URL = CONFIG.baseUrl.replace(/\/$/, "");
  const STATE = {
    isOpen: false,
    controller: null,
  };

  function pickString() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return "";
  }

  function buildEndpoint() {
    const name = encodeURIComponent(CONFIG.collectionName);
    return BASE_URL + "/api/vector/collections/" + name + "/search/generative";
  }

  function ensureStyles() {
    if (document.getElementById("ai-kms-widget-styles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "ai-kms-widget-styles";
    style.textContent = ${JSON.stringify(widgetCss)};
    document.head.appendChild(style);
  }

  function createDom() {
    let container = document.getElementById("ai-kms-chat-widget");
    if (container) {
      return container;
    }

    container = document.createElement("div");
    container.id = "ai-kms-chat-widget";
    container.innerHTML = ${JSON.stringify(widgetMarkup)};
    const target = document.body || document.documentElement;
    target.appendChild(container);
    return container;
  }

  function setPanelOpen(panel, isOpen) {
    STATE.isOpen = Boolean(isOpen);
    if (!panel) {
      return;
    }

    if (isOpen) {
      panel.classList.add("akms-open");
      panel.setAttribute("aria-hidden", "false");
    } else {
      panel.classList.remove("akms-open");
      panel.setAttribute("aria-hidden", "true");
    }
  }

  function appendMessage(root, role, text) {
    const wrapper = document.createElement("div");
    wrapper.className = role === "user" ? "akms-message akms-message-user" : "akms-message";

    const avatar = document.createElement("div");
    avatar.className = role === "user" ? "akms-user-avatar" : "akms-assistant-avatar";
    avatar.textContent = role === "user" ? "Вы" : "AI";

    const bubble = document.createElement("div");
    bubble.className = "akms-bubble";
    bubble.textContent = text;

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    root.appendChild(wrapper);
    root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });

    return { wrapper, bubble };
  }

  function setLoadingState(sendButton, input, status, isLoading) {
    sendButton.disabled = isLoading;
    input.disabled = isLoading;
    if (isLoading) {
      status.hidden = false;
      status.textContent = "Генерируем ответ…";
    } else {
      status.hidden = true;
      status.textContent = "";
    }
  }

  function resetSources(container) {
    container.hidden = true;
    container.innerHTML = "";
  }

  function renderSources(container, metadata) {
    if (!metadata || !Array.isArray(metadata.context) || metadata.context.length === 0) {
      resetSources(container);
      return;
    }

    container.hidden = false;
    container.innerHTML = "";

    const title = document.createElement("div");
    title.className = "akms-status";
    title.textContent = "Источники ответа";
    container.appendChild(title);

    metadata.context.forEach((entry, index) => {
      const payload = entry && entry.payload && typeof entry.payload === "object" ? entry.payload : {};
      const url = pickString(payload.url, payload.link, payload.href, payload.pageUrl, payload.sourceUrl);
      const titleText = pickString(
        payload.title,
        payload.heading,
        payload.pageTitle,
        "Источник " + (index + 1),
      ) || "Источник " + (index + 1);
      const snippet = pickString(payload.excerpt, payload.description, payload.text, payload.content);

      const item = document.createElement("div");
      item.className = "akms-source-item";

      const link = document.createElement(url ? "a" : "div");
      link.className = "akms-source-title";
      link.textContent = titleText;
      if (url) {
        link.setAttribute("href", url);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }

      const body = document.createElement("div");
      body.className = "akms-source-snippet";
      body.textContent = snippet || "Контент без описания";

      item.appendChild(link);
      item.appendChild(body);
      container.appendChild(item);
    });
  }

  async function streamAnswer(question, elements) {
    const endpoint = buildEndpoint();
    const controller = new AbortController();
    STATE.controller = controller;

    const requestBody = {
      query: question,
      embeddingProviderId: CONFIG.embeddingProviderId,
      llmProviderId: CONFIG.llmProviderId,
      llmModel: CONFIG.llmModel,
      limit: CONFIG.limit,
      contextLimit: CONFIG.contextLimit,
      publicId: CONFIG.publicId,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-API-Key": CONFIG.apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      let message = response.statusText || "Не удалось получить ответ";
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.error) {
          message = String(parsed.error);
          if (parsed.details) {
            message += " — " + parsed.details;
          }
        }
      } catch (error) {
        if (raw.trim().length > 0) {
          message = raw.trim();
        }
      }
      throw new Error(message);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.body || !contentType.includes("text/event-stream")) {
      const fallback = await response.json();
      if (fallback && typeof fallback === "object") {
        return {
          answer: typeof fallback.answer === "string" ? fallback.answer : "",
          metadata: {
            context: Array.isArray(fallback.context) ? fallback.context : [],
            provider: fallback.provider ?? null,
            embeddingProvider: fallback.embeddingProvider ?? null,
          },
        };
      }

      return { answer: "", metadata: null };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let answer = "";
    let metadata = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");

      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary).replace(/\r/g, "").trim();
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        if (!rawEvent) {
          continue;
        }

        const lines = rawEvent.split("\n");
        let eventName = "message";
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const payload = dataLines.join("\n");
        if (!payload) {
          continue;
        }

        if (payload === "[DONE]") {
          return { answer, metadata };
        }

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch (error) {
          continue;
        }

        if (eventName === "metadata") {
          metadata = parsed;
          renderSources(elements.sources, metadata);
          continue;
        }

        if (eventName === "token" && parsed && typeof parsed === "object" && typeof parsed.delta === "string") {
          answer += parsed.delta;
          elements.bubble.textContent = answer;
          elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: "smooth" });
          continue;
        }

        if (eventName === "complete" && parsed && typeof parsed === "object") {
          if (parsed.answer) {
            answer = parsed.answer;
            elements.bubble.textContent = answer;
          }
          return { answer, metadata };
        }

        if (eventName === "error" && parsed && typeof parsed === "object") {
          const message = typeof parsed.message === "string" ? parsed.message : "Ошибка генерации";
          throw new Error(message);
        }
      }
    }

    return { answer, metadata };
  }

  ensureStyles();
  const container = createDom();
  const toggleButton = container.querySelector('[data-ai-kms="toggle"]');
  const panel = container.querySelector('[data-ai-kms="panel"]');
  const closeButton = container.querySelector('[data-ai-kms="close"]');
  const messagesRoot = container.querySelector('[data-ai-kms="messages"]');
  const sourcesRoot = container.querySelector('[data-ai-kms="sources"]');
  const status = container.querySelector('[data-ai-kms="status"]');
  const textarea = container.querySelector('[data-ai-kms="input"]');
  const sendButton = container.querySelector('[data-ai-kms="send"]');

  function handleToggle() {
    setPanelOpen(panel, !STATE.isOpen);
    if (STATE.isOpen) {
      textarea.focus();
    }
  }

  toggleButton.addEventListener("click", handleToggle);
  closeButton.addEventListener("click", () => setPanelOpen(panel, false));

  textarea.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendButton.click();
    }
  });

  sendButton.addEventListener("click", async () => {
    const question = textarea.value.trim();
    if (!question) {
      return;
    }

    if (STATE.controller) {
      STATE.controller.abort();
      STATE.controller = null;
    }

    textarea.value = "";
    const userMessage = appendMessage(messagesRoot, "user", question);
    const assistantMessage = appendMessage(messagesRoot, "assistant", "");
    assistantMessage.wrapper.classList.remove("akms-error");
    resetSources(sourcesRoot);
    setLoadingState(sendButton, textarea, status, true);

    try {
      const result = await streamAnswer(question, {
        wrapper: assistantMessage.wrapper,
        bubble: assistantMessage.bubble,
        messages: messagesRoot,
        sources: sourcesRoot,
      });

      if (result && result.answer) {
        assistantMessage.bubble.textContent = result.answer;
      }

      if (result && result.metadata) {
        renderSources(sourcesRoot, result.metadata);
      }
    } catch (error) {
      assistantMessage.wrapper.classList.add("akms-error");
      assistantMessage.bubble.textContent = error instanceof Error ? error.message : "Не удалось получить ответ";
    } finally {
      setLoadingState(sendButton, textarea, status, false);
      STATE.controller = null;
    }
  });

  window.__AI_KMS_CHAT_WIDGET__ = {
    open: () => setPanelOpen(panel, true),
    close: () => setPanelOpen(panel, false),
  };

  const missing = [];
  if (!CONFIG.apiKey || CONFIG.apiKey === "PUBLIC_API_KEY") {
    missing.push("API-ключ");
  }
  if (!CONFIG.publicId || CONFIG.publicId === "SITE_PUBLIC_ID") {
    missing.push("publicId проекта");
  }
  if (!CONFIG.collectionName || CONFIG.collectionName === "COLLECTION_NAME") {
    missing.push("название коллекции");
  }

  if (missing.length > 0) {
    console.warn("[AI KMS] Заполните настройки виджета перед использованием:", missing.join(", "));
  }
})();`;
  }, [scriptConfig]);

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      toast({
        title: "Скрипт скопирован",
        description: `${label} готов к вставке на ваш сайт`,
      });
      setTimeout(() => setCopied(""), 2000);
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleNumberChange = (setter: (value: number) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseInt(event.target.value, 10);
    if (Number.isFinite(nextValue)) {
      setter(Math.max(1, nextValue));
    } else if (event.target.value === "") {
      setter(NaN);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span>Поделитесь RAG-помощником со своими пользователями</span>
        </div>
        <h1 className="text-3xl font-semibold">Готовый JS-скрипт чат-виджета</h1>
        <p className="text-muted-foreground text-base">
          Сгенерируйте скрипт, который подключается к вашей векторной базе и LLM. Клиенты вставят его на сайт и получат
          диалоговый поиск с мгновенным ответом и ссылками на источники.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Настройки соединения</CardTitle>
          <CardDescription>Выберите проект, сервис эмбеддингов и провайдера LLM, которые будут использоваться виджетом.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="widget-site">Проект</Label>
              <Select value={selectedSite?.id ?? ""} onValueChange={(value) => setSelectedSiteId(value)}>
                <SelectTrigger id="widget-site" className="bg-background">
                  <SelectValue placeholder="Выберите проект" />
                </SelectTrigger>
                <SelectContent>
                  {activeSites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      <div className="flex flex-col gap-0.5">
                        <span>{site.name}</span>
                        <span className="text-xs text-muted-foreground">{site.url}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="widget-embedding">Сервис эмбеддингов</Label>
              <Select value={selectedEmbeddingProvider?.id ?? ""} onValueChange={(value) => setSelectedEmbeddingId(value)}>
                <SelectTrigger id="widget-embedding" className="bg-background">
                  <SelectValue placeholder="Выберите сервис" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmbeddingProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {formatProviderLabel(provider)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="widget-llm">Провайдер LLM и модель</Label>
              <Select value={selectedLlmOption?.key ?? ""} onValueChange={(value) => setSelectedLlmKey(value)}>
                <SelectTrigger id="widget-llm" className="bg-background">
                  <SelectValue placeholder="Выберите модель" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {llmModelOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      <div className="flex flex-col gap-0.5">
                        <span>{option.provider.name}</span>
                        <span className="text-xs text-muted-foreground">{option.model.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="widget-limit">Количество документов (top-k)</Label>
                <Input
                  id="widget-limit"
                  type="number"
                  min={1}
                  value={Number.isFinite(limit) ? limit : ""}
                  onChange={handleNumberChange(setLimit)}
                  placeholder="5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="widget-context">Контекст для LLM</Label>
                <Input
                  id="widget-context"
                  type="number"
                  min={1}
                  value={Number.isFinite(contextLimit) ? contextLimit : ""}
                  onChange={handleNumberChange(setContextLimit)}
                  placeholder="3"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">API-ключ</span>
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="truncate font-mono">{selectedSite?.publicApiKey ?? "PUBLIC_API_KEY"}</span>
                <Badge variant="outline" className="uppercase">public</Badge>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs uppercase text-muted-foreground tracking-wide">Коллекция</span>
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="truncate font-mono">{collectionName ?? "COLLECTION_NAME"}</span>
                <Badge variant="secondary" className="uppercase">Qdrant</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <CardTitle>Скрипт виджета</CardTitle>
            <CardDescription>Скопируйте код и вставьте перед закрывающим тегом &lt;/body&gt; на стороне клиента.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCopy(`<script>${scriptTemplate}</script>`, "Скрипт виджета")}
            className="gap-2"
          >
            <Copy className="h-4 w-4" />
            {copied === "Скрипт виджета" ? "Скопировано" : "Скопировать"}
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[480px] rounded-lg border bg-muted/40">
            <pre className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap">{`<script>` + scriptTemplate + `</script>`}</pre>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Как подключить виджет</CardTitle>
          <CardDescription>Пошаговая инструкция для интегратора.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-3 pl-4">
            <li>
              <span className="font-medium">Скопируйте код виджета.</span> Добавьте его перед тегом &lt;/body&gt; на страницах, где нужен
              чат.
            </li>
            <li>
              <span className="font-medium">Разрешите домен клиента в CORS.</span> В настройках проекта добавьте домен сайта, чтобы
              публичный API принимал запросы.
            </li>
            <li>
              <span className="font-medium">Передайте API-ключ и publicId.</span> Они уже зашиты в скрипт — при необходимости
              сгенерируйте новый ключ на вкладке проектов.
            </li>
            <li>
              <span className="font-medium">Проверьте соединение.</span> После вставки скрипта откройте сайт, задайте несколько
              вопросов и убедитесь, что ответы и источники приходят мгновенно.
            </li>
          </ol>
          <Separator />
          <Alert className="bg-muted/60">
            <Info className="h-4 w-4" />
            <AlertTitle>Безопасность</AlertTitle>
            <AlertDescription>
              Публичный API использует API-ключ проекта и публичный идентификатор. Ключ можно заменить в любой момент — это
              автоматически отключит старый скрипт.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

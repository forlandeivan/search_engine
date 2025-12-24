import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Copy, ExternalLink, Sparkles, Workflow } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FALLBACK_EXTERNAL_API_HOST = "https://aiknowledge.ru";

type DocId = "vector-search" | "rag-search";

type RequestField = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

type DocSection = {
  id: DocId;
  title: string;
  description: string;
  icon: typeof Workflow;
  method: "POST";
  endpointPath: string;
  steps: string[];
  requestFields: RequestField[];
  requestExample: (host: string) => string;
  responseExample: string;
  tips: string[];
};

const DOC_SECTIONS: DocSection[] = [
  {
    id: "vector-search",
    title: "Векторный поиск",
    description: "Используйте готовый вектор, чтобы получить ближайшие документы в Qdrant.",
    icon: Workflow,
    method: "POST",
    endpointPath: "/api/public/collections/search/vector",
    steps: [
      "Создайте запрос POST и укажите тело в формате raw JSON.",
      "В заголовках добавьте X-API-Key со значением публичного ключа коллекции и Content-Type: application/json.",
      "Передайте workspace_id вашего рабочего пространства и имя коллекции (collection).",
      "Заполните поле vector — передайте массив чисел или именованный вектор, полученный из сервиса эмбеддингов.",
      "Добавьте limit/offset и флаги withPayload, withVector при необходимости и отправьте запрос.",
    ],
    requestFields: [
      {
        name: "workspace_id",
        type: "string",
        required: true,
        description: "Идентификатор рабочего пространства. Используется для валидации публичного ключа.",
      },
      {
        name: "collection",
        type: "string",
        required: true,
        description: "Имя коллекции в Qdrant, из которой нужно получить результаты.",
      },
      {
        name: "vector",
        type: "number[] | { name: string; vector: number[] }",
        required: true,
        description: "Сам вектор поиска. Можно передать массив чисел или именованный вектор для коллекций с несколькими пространствами.",
      },
      {
        name: "limit",
        type: "number",
        required: false,
        description: "Количество точек в ответе. По умолчанию 10, максимум 100.",
      },
      {
        name: "offset",
        type: "number",
        required: false,
        description: "Смещение результатов. Удобно для постраничного просмотра.",
      },
      {
        name: "withPayload",
        type: "boolean | object",
        required: false,
        description: "Передайте true, чтобы получить исходные данные документа вместе с точкой.",
      },
    ],
    requestExample: (host) => `POST ${host}/api/public/collections/search/vector\nX-API-Key: pk_live_your_key\nContent-Type: application/json\n\n{\n  "workspace_id": "ws_1234567890",\n  "collection": "kb_public_docs",\n  "vector": [0.1123, -0.0648, 0.3201, 0.4872, -0.1924],\n  "limit": 5,\n  "offset": 0,\n  "withPayload": true,\n  "withVector": false\n}`,
    responseExample: `{
  "collection": "kb_public_docs",
  "results": [
    {
      "id": "73442d5a-1b28-4a6f-9f1a-2a2e2db0f730",
      "score": 0.8321,
      "payload": {
        "title": "FAQ: Интеграция",
        "url": "https://docs.example.com/faq",
        "snippet": "Используйте публичный API ключ, чтобы инициализировать поиск..."
      },
      "vector": null
    }
  ]
}`,
    tips: [
      "Если коллекция работает с именованными векторами, вместо массива передайте объект { name, vector }.",
      "В withPayload можно указать объект с выборкой полей (как в Qdrant), чтобы сократить ответ.",
      "Для фильтрации результатов используйте параметр filter из синтаксиса Qdrant.",
    ],
  },
  {
    id: "rag-search",
    title: "RAG-поиск",
    description: "Полный поиск с генерацией ответа на основе контента базы знаний.",
    icon: Sparkles,
    method: "POST",
    endpointPath: "/api/public/collections/search/rag",
    steps: [
      "Создайте запрос POST и включите ключ X-API-Key плюс заголовок Content-Type: application/json.",
      "В теле запроса обязательно передайте workspace_id, collection и сам текстовый запрос (query).",
      "Укажите embeddingProviderId и llmProviderId. Дополнительно можно выбрать llmModel, температуру и лимиты.",
      "Добавьте contextLimit или limit, чтобы управлять количеством источников, возвращаемых в ответе.",
      "При необходимости задайте responseFormat (text, markdown, html) и флаги includeContext / includeQueryVector.",
    ],
    requestFields: [
      {
        name: "workspace_id",
        type: "string",
        required: true,
        description: "Рабочее пространство, к которому привязан публичный ключ.",
      },
      {
        name: "collection",
        type: "string",
        required: true,
        description: "Имя коллекции Qdrant с документами базы знаний.",
      },
      {
        name: "query",
        type: "string",
        required: true,
        description: "Пользовательский вопрос, для которого нужно получить ответ.",
      },
      {
        name: "embeddingProviderId",
        type: "string",
        required: true,
        description: "ID сервиса эмбеддингов из настроек рабочей области.",
      },
      {
        name: "llmProviderId",
        type: "string",
        required: true,
        description: "ID провайдера LLM, который будет генерировать ответ.",
      },
      {
        name: "llmModel",
        type: "string",
        required: false,
        description: "Конкретная модель провайдера. Если не указано, используется значение по умолчанию.",
      },
      {
        name: "contextLimit",
        type: "number",
        required: false,
        description: "Максимум контекстных чанков, добавляемых в ответ и в LLM.",
      },
      {
        name: "responseFormat",
        type: "\"text\" | \"markdown\" | \"html\"",
        required: false,
        description: "Формат финального ответа. По умолчанию text.",
      },
      {
        name: "includeContext",
        type: "boolean",
        required: false,
        description: "Передайте true, чтобы в ответе пришёл список чанков, отправленных в LLM.",
      },
    ],
    requestExample: (host) => `POST ${host}/api/public/collections/search/rag\nX-API-Key: pk_live_your_key\nContent-Type: application/json\n\n{\n  "workspace_id": "ws_1234567890",\n  "collection": "kb_public_docs",\n  "query": "Как подключить поиск к сайту?",\n  "embeddingProviderId": "openai-embeddings",\n  "llmProviderId": "openai",\n  "llmModel": "gpt-4o-mini",\n  "limit": 5,\n  "contextLimit": 8,\n  "responseFormat": "markdown",\n  "includeContext": true,\n  "includeQueryVector": false\n}`,
    responseExample: `{
  "answer": "1. Создайте публичный API-ключ в админке.\n2. Подключите виджет или вызывайте эндпоинт /search/vector.\n3. При необходимости используйте RAG, чтобы получить готовый ответ.",
  "format": "markdown",
  "usage": {
    "embeddingTokens": 154,
    "llmTokens": 512
  },
  "provider": {
    "id": "openai",
    "name": "OpenAI",
    "model": "gpt-4o-mini",
    "modelLabel": "GPT-4o mini"
  },
  "embeddingProvider": {
    "id": "openai-embeddings",
    "name": "OpenAI Embeddings"
  },
  "collection": "kb_public_docs",
  "sources": [
    {
      "url": "https://docs.example.com/setup",
      "title": "Настройка интеграции",
      "snippet": "Добавьте скрипт виджета на сайт и укажите публичный ключ...",
      "chunkId": "chunk_9d12",
      "documentId": "doc_a1b2"
    }
  ],
  "context": [
    {
      "id": "chunk_9d12",
      "score": 0.9123,
      "payload": {
        "title": "Настройка интеграции",
        "url": "https://docs.example.com/setup"
      }
    }
  ]
}`,
    tips: [
      "Если используете Embed Key, убедитесь, что Origin в Postman совпадает с доменом из allowlist — добавьте заголовок X-Embed-Origin.",
      "Передайте kbId, чтобы ограничить поиск конкретной базой знаний внутри рабочего пространства.",
      "Для гибридного поиска добавьте объект hybrid с настройками bm25 и vector (weight, limit).",
    ],
  },
];

export default function ApiDocsPage() {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<DocId>("vector-search");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const apiDocsHost = useMemo(
    () => (typeof window !== "undefined" ? window.location.origin : FALLBACK_EXTERNAL_API_HOST),
    [],
  );

  const sectionsById = useMemo(() => {
    return new Map(DOC_SECTIONS.map((section) => [section.id, section]));
  }, []);

  const activeDoc = sectionsById.get(activeSection);
  const activeDocEndpointUrl = activeDoc ? `${apiDocsHost}${activeDoc.endpointPath}` : "";
  const activeDocRequestExample = activeDoc ? activeDoc.requestExample(apiDocsHost) : "";

  const copyToClipboard = async (text: string, token: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
      toast({ title: "Скопировано", description: "Содержимое отправлено в буфер обмена" });
    } catch {
      toast({ title: "Ошибка", description: "Не удалось скопировать", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6" data-testid="page-api-docs">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-foreground">Документация API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Выберите инструкцию слева, чтобы увидеть пошаговое описание и примеры для Postman.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <aside className="rounded-lg border bg-background">
          <ScrollArea className="h-[calc(100vh-220px)] p-3">
            <nav className="space-y-2">
              {DOC_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent hover:border-muted hover:bg-muted"
                    }`}
                    data-testid={`nav-${section.id}`}
                  >
                    <Icon className="mt-0.5 h-4 w-4" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{section.title}</p>
                      <p className="text-xs text-muted-foreground">{section.description}</p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </ScrollArea>
        </aside>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold">Перед началом</CardTitle>
              <CardDescription>
                Эти инструкции подходят для внешних интеграций и тестирования через Postman.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                1. Получите публичный ключ коллекции в админ-панели (Раздел «Интеграции» → «Публичный API»).
              </p>
              <p>
                2. Скопируйте workspace_id рабочего пространства — он нужен в теле запроса вместе с коллекцией.
              </p>
              <p>
                3. В Postman используйте метод <strong>POST</strong>, добавьте заголовок X-API-Key и передавайте тело как raw JSON.
              </p>
              <p>
                4. Если для ключа настроен allowlist доменов, добавьте заголовок <code>X-Embed-Origin</code> с доменом.
              </p>
            </CardContent>
          </Card>

          {activeDoc ? (
            <Card data-testid={`content-${activeDoc.id}`}>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="font-semibold uppercase">
                        {activeDoc.method}
                      </Badge>
                      <code className="text-sm font-mono">{activeDocEndpointUrl}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          copyToClipboard(
                            activeDocEndpointUrl,
                            `${activeDoc.id}-endpoint`,
                          )
                        }
                        aria-label="Скопировать URL"
                      >
                        {copiedToken === `${activeDoc.id}-endpoint` ? (
                          <span className="text-xs">Ок</span>
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <CardTitle className="mt-3 text-2xl font-semibold">{activeDoc.title}</CardTitle>
                    <CardDescription className="mt-1 text-sm">
                      {activeDoc.description}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    asChild
                    className="shrink-0"
                    aria-label="Открыть описание в новой вкладке"
                  >
                    <a href={activeDocEndpointUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <section className="space-y-2 text-sm">
                  <h3 className="text-base font-semibold text-foreground">Как протестировать в Postman</h3>
                  <ol className="list-decimal space-y-2 pl-4 text-muted-foreground">
                    {activeDoc.steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </section>

                <section>
                  <h3 className="text-base font-semibold text-foreground">Поля тела запроса</h3>
                  <div className="mt-3 overflow-hidden rounded-md border">
                    <div className="grid grid-cols-[150px_130px_1fr] gap-3 bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Поле</span>
                      <span>Тип</span>
                      <span>Описание</span>
                    </div>
                    <div className="divide-y text-sm">
                      {activeDoc.requestFields.map((field) => (
                        <div key={field.name} className="grid grid-cols-[150px_130px_1fr] gap-3 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <code>{field.name}</code>
                            {field.required ? (
                              <Badge variant="destructive" className="px-1 text-[10px] uppercase">
                                Обязательное
                              </Badge>
                            ) : null}
                          </div>
                          <span className="text-xs text-muted-foreground">{field.type}</span>
                          <span className="text-sm text-muted-foreground">{field.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-base font-semibold text-foreground">Пример запроса</h3>
                  <div className="mt-3 rounded-md border bg-muted/60">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <span className="text-xs font-medium uppercase text-muted-foreground">Curl / Raw</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(activeDocRequestExample, `${activeDoc.id}-request`)}
                        aria-label="Скопировать пример запроса"
                      >
                        {copiedToken === `${activeDoc.id}-request` ? (
                          <span className="text-xs">Ок</span>
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <ScrollArea className="max-h-72">
                      <pre className="whitespace-pre-wrap px-3 py-3 text-xs text-muted-foreground">
                        {activeDocRequestExample}
                      </pre>
                    </ScrollArea>
                  </div>
                </section>

                <section>
                  <h3 className="text-base font-semibold text-foreground">Пример ответа</h3>
                  <div className="mt-3 rounded-md border bg-muted/60">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <span className="text-xs font-medium uppercase text-muted-foreground">JSON</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(activeDoc.responseExample, `${activeDoc.id}-response`) }
                        aria-label="Скопировать пример ответа"
                      >
                        {copiedToken === `${activeDoc.id}-response` ? (
                          <span className="text-xs">Ок</span>
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <ScrollArea className="max-h-72">
                      <pre className="whitespace-pre-wrap px-3 py-3 text-xs text-muted-foreground">
                        {activeDoc.responseExample}
                      </pre>
                    </ScrollArea>
                  </div>
                </section>

                <section>
                  <h3 className="text-base font-semibold text-foreground">Подсказки</h3>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    {activeDoc.tips.map((tip, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <Separator />

                <p className="text-xs text-muted-foreground">
                  Нужны дополнительные примеры? Напишите в поддержку, и мы подготовим готовые коллекции Postman.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

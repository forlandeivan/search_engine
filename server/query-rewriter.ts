/**
 * Query Rewriter Service
 * 
 * Переформулирует уточняющие вопросы для улучшения качества RAG retrieval.
 * Использует LLM для раскрытия анафорических ссылок и контекстных вопросов.
 */

import { performance } from "perf_hooks";
import type { LlmProvider } from "@shared/schema";
import { fetchAccessToken, executeLlmCompletion } from "./llm-client";
import { buildLlmRequestBody } from "./search/utils";
import type { ChatConversationMessage } from "./chat-service";
import { createLogger } from "./lib/logger";

const logger = createLogger("QUERY_REWRITER");

export interface QueryRewriteResult {
  originalQuery: string;
  rewrittenQuery: string;
  wasRewritten: boolean;
  confidence?: number;
  reason?: string;
}

export interface QueryRewriteOptions {
  llmProvider: LlmProvider;
  model?: string;
  timeout?: number;
}

const REWRITE_SYSTEM_PROMPT = `Ты помощник, который улучшает поисковые запросы для системы RAG (Retrieval Augmented Generation).

Твоя задача: переформулировать вопрос пользователя так, чтобы он стал самодостаточным поисковым запросом.

Правила:
1. Если вопрос содержит ссылки на предыдущий контекст (например, "об этом", "подробнее", "какие ещё", "исключения"), раскрой эти ссылки используя историю диалога.
2. Если вопрос уже самодостаточный — верни его без изменений.
3. Сохраняй суть вопроса, не добавляй лишнюю информацию.
4. Отвечай ТОЛЬКО переформулированным запросом, без пояснений и кавычек.`;

function buildRewritePrompt(
  history: ChatConversationMessage[],
  currentQuery: string
): string {
  const historyText = history
    .map((msg) => `${msg.role === "user" ? "Пользователь" : "Ассистент"}: ${msg.content}`)
    .join("\n\n");

  return `История диалога:
${historyText || "(пустая история)"}

Текущий вопрос пользователя: ${currentQuery}

Переформулированный запрос:`;
}

/**
 * Эвристика: нужна ли переформулировка?
 */
export function needsRewriting(query: string, history: ChatConversationMessage[]): boolean {
  // Нет истории — нечего раскрывать
  if (history.length === 0) {
    return false;
  }

  const trimmedQuery = query.trim();
  
  // Пустая строка или только пробелы
  if (trimmedQuery.length === 0) {
    return false;
  }

  const lowerQuery = trimmedQuery.toLowerCase();

  // Паттерны, указывающие на ссылку к предыдущему контексту
  // Примечание: \b не работает с кириллицей в JavaScript, используем альтернативные паттерны
  const contextualPatterns = [
    /(^|\s)об этом(\s|$|[?!.,])/,
    /(^|\s)про это(\s|$|[?!.,])/,
    /(^|\s)подробнее(\s|$|[?!.,])/,
    /(^|\s)детальнее(\s|$|[?!.,])/,
    /(^|\s)расскажи ещё(\s|$|[?!.,])/,
    /(^|\s)расскажи еще(\s|$|[?!.,])/,
    /(^|\s)какие ещё(\s|$|[?!.,])/,
    /(^|\s)какие еще(\s|$|[?!.,])/,
    /(^|\s)а что насчёт(\s|$|[?!.,])/,
    /(^|\s)а что насчет(\s|$|[?!.,])/,
    /(^|\s)исключения?(\s|$|[?!.,])/,
    /(^|\s)пример(ы|ов)?(\s|$|[?!.,])/,
    /(^|\s)пункт(а|е|у|ом|е)?\s+\d+/i, // Пункт с падежами и числом
    /(^|\s)раздел(а|е|у|ом|е)?\s+\d+/i, // Раздел с падежами и числом
    /(^|\s)из\s+(этого|того|этих|тех)(\s|$|[?!.,])/i, // "из этого", "из того"
    /(^|\s)(он|она|оно|они|это|эти|тот|та|те)(\s|$|[?!.,])/, // Но исключаем "что такое"
    /^(а|и|но|да)\s+/i, // Начинается с союза
    /^(что|как|где|когда|почему|зачем)\s+(ещё|еще|там|здесь)/i,
  ];

  // Исключения: паттерны, которые НЕ должны триггерить rewriting
  const exclusionPatterns = [
    /^что\s+такое\s+/i, // "Что такое X?" - самодостаточный вопрос
  ];

  // Проверяем исключения
  for (const pattern of exclusionPatterns) {
    if (pattern.test(lowerQuery)) {
      return false;
    }
  }

  // Проверяем контекстные паттерны
  for (const pattern of contextualPatterns) {
    if (pattern.test(lowerQuery)) {
      // Дополнительная проверка: если это "это" в контексте "что такое", не триггерим
      if (/\bэто\b/.test(lowerQuery) && /^что\s+такое/.test(lowerQuery)) {
        continue;
      }
      return true;
    }
  }

  // Короткий запрос без существительных — вероятно, уточнение
  const words = lowerQuery.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 3) {
    // Проверяем, есть ли хотя бы одно существительное (грубая эвристика)
    // Расширенный паттерн для существительных (включая множественное число и разные падежи)
    // Убираем знаки препинания для проверки
    const cleanQuery = trimmedQuery.replace(/[?!.,;:]/g, '');
    const hasNoun = /[а-яё]{4,}(ие|ия|ий|ая|ое|ые|ов|ей|ах|ях|ом|ем|ой|ей|и|ы|а|я|у|ю|е|о)(\s|$|[?!.,])/i.test(cleanQuery);
    if (!hasNoun) {
      return true;
    }
  }

  return false;
}

function extractRewrittenQuery(llmResponse: unknown): string | null {
  // OpenAI-compatible format
  if (
    typeof llmResponse === "object" &&
    llmResponse !== null &&
    "choices" in llmResponse &&
    Array.isArray((llmResponse as { choices?: unknown[] }).choices) &&
    (llmResponse as { choices?: unknown[] }).choices?.[0] &&
    typeof (llmResponse as { choices?: unknown[] }).choices[0] === "object" &&
    (llmResponse as { choices?: unknown[] }).choices[0] !== null &&
    "message" in (llmResponse as { choices?: unknown[] }).choices[0] &&
    typeof ((llmResponse as { choices?: unknown[] }).choices[0] as { message?: unknown }).message === "object" &&
    ((llmResponse as { choices?: unknown[] }).choices[0] as { message?: unknown }).message !== null &&
    "content" in ((llmResponse as { choices?: unknown[] }).choices[0] as { message?: unknown }).message
  ) {
    const content = ((llmResponse as { choices?: unknown[] }).choices[0] as { message?: { content?: unknown } }).message?.content;
    if (typeof content === "string") {
      return content;
    }
  }
  
  // Fallback formats
  if (typeof llmResponse === "object" && llmResponse !== null) {
    if ("content" in llmResponse && typeof (llmResponse as { content?: unknown }).content === "string") {
      return (llmResponse as { content: string }).content;
    }
    if ("text" in llmResponse && typeof (llmResponse as { text?: unknown }).text === "string") {
      return (llmResponse as { text: string }).text;
    }
    if ("answer" in llmResponse && typeof (llmResponse as { answer?: unknown }).answer === "string") {
      return (llmResponse as { answer: string }).answer;
    }
  }
  
  return null;
}

/**
 * Переформулирует запрос с учётом истории диалога
 */
export async function rewriteQuery(
  query: string,
  conversationHistory: ChatConversationMessage[],
  options: QueryRewriteOptions
): Promise<QueryRewriteResult> {
  const { llmProvider, model, timeout = 5000 } = options;

  // Быстрая проверка: нужна ли переформулировка?
  if (!needsRewriting(query, conversationHistory)) {
    logger.debug({
      originalQuery: query,
      reason: "query_is_self_contained",
    }, "[QUERY_REWRITER] Query does not need rewriting");
    
    return {
      originalQuery: query,
      rewrittenQuery: query,
      wasRewritten: false,
      reason: "Query is self-contained",
    };
  }

  try {
    const accessToken = await fetchAccessToken(llmProvider);
    
    // Используем fetchLlmCompletion для единообразия с остальным кодом
    const rewriteStart = performance.now();
    
    const userPrompt = buildRewritePrompt(conversationHistory, query);
    
    // Создаем временный провайдер без system prompt для rewriting
    // (чтобы использовать только наш специальный system prompt)
    const rewriteProvider: LlmProvider = {
      ...llmProvider,
      requestConfig: {
        ...llmProvider.requestConfig,
        systemPrompt: "", // Очищаем system prompt, используем только наш из истории
      },
    };
    
    // Создаем историю для LLM: system prompt + user prompt
    const rewriteHistory: ChatConversationMessage[] = [
      { role: "system", content: REWRITE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];
    
    // Используем buildLlmRequestBody и executeLlmCompletion для rewriting
    // Передаем пустую строку как query, так как весь промпт уже в истории
    const requestBody = buildLlmRequestBody(
      rewriteProvider,
      "", // Пустой query, так как весь промпт в истории
      [], // Нет контекста для rewriting
      model,
      {
        conversationHistory: rewriteHistory,
      }
    );
    
    const completionPromise = executeLlmCompletion(
      llmProvider,
      accessToken,
      requestBody,
      {}
    );
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Query rewrite timeout")), timeout);
    });
    
    const completion = await Promise.race([completionPromise, timeoutPromise]);

    const rewriteDuration = performance.now() - rewriteStart;
    
    // Извлекаем переформулированный запрос из ответа
    const rewrittenQuery = extractRewrittenQuery(completion.rawResponse) ?? completion.answer;

    // Валидация результата
    if (!rewrittenQuery || rewrittenQuery.trim().length < 3) {
      logger.warn({
        originalQuery: query,
        reason: "invalid_rewrite_result",
        rawResponse: completion.rawResponse,
      }, "[QUERY_REWRITER] Invalid rewrite result, using original query");
      
      return {
        originalQuery: query,
        rewrittenQuery: query,
        wasRewritten: false,
        reason: "Invalid rewrite result",
      };
    }

    const trimmedRewritten = rewrittenQuery.trim();
    const wasRewritten = trimmedRewritten !== query.trim();

    logger.info({
      originalQuery: query,
      rewrittenQuery: trimmedRewritten,
      wasRewritten,
      durationMs: rewriteDuration,
      historyLength: conversationHistory.length,
    }, wasRewritten ? "[QUERY_REWRITER] Query rewritten successfully" : "[QUERY_REWRITER] Query unchanged after rewrite");

    return {
      originalQuery: query,
      rewrittenQuery: trimmedRewritten,
      wasRewritten,
      confidence: 0.9,
    };
  } catch (error) {
    logger.warn({
      originalQuery: query,
      error: error instanceof Error ? error.message : String(error),
    }, "[QUERY_REWRITER] Rewrite failed, using original query");
    
    return {
      originalQuery: query,
      rewrittenQuery: query,
      wasRewritten: false,
      reason: `Error: ${error instanceof Error ? error.message : "Unknown"}`,
    };
  }
}

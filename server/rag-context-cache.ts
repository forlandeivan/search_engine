/**
 * RAG Context Cache Service
 * 
 * Кэширует результаты retrieval между запросами в рамках одного диалога
 * для оптимизации производительности и обеспечения консистентности контекста.
 */

// Тип для чанка из RAG результата
export interface RagChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_title: string | null;
  snippet: string;
  text?: string;
  score: number;
  scores?: { bm25?: number; vector?: number };
  node_id?: string | null;
  node_slug?: string | null;
  knowledge_base_id?: string | null;
}

export interface CachedRetrievalResult {
  query: string;
  normalizedQuery: string;
  chunks: RagChunk[];
  timestamp: number;
  embeddingVector?: number[];
}

export interface ChatContextCache {
  chatId: string;
  workspaceId: string;
  retrievals: CachedRetrievalResult[];
  accumulatedChunks: Map<string, RagChunk>; // chunkId -> chunk (дедупликация)
  createdAt: number;
  lastAccessedAt: number;
  ttlMs: number; // TTL из настроек навыка
}

// In-memory кэш (можно заменить на Redis для масштабирования)
const contextCaches = new Map<string, ChatContextCache>();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 минут по умолчанию
const MAX_CACHED_RETRIEVALS = 10;
const MAX_ACCUMULATED_CHUNKS = 50;

/**
 * Получает или создает кэш для чата
 */
export function getOrCreateCache(
  chatId: string,
  workspaceId: string,
  ttlSeconds?: number
): ChatContextCache {
  const existing = contextCaches.get(chatId);
  
  if (existing && existing.workspaceId === workspaceId) {
    existing.lastAccessedAt = Date.now();
    // Обновляем TTL, если изменился
    if (ttlSeconds !== undefined) {
      existing.ttlMs = ttlSeconds * 1000;
    }
    return existing;
  }

  const ttlMs = ttlSeconds ? ttlSeconds * 1000 : DEFAULT_TTL_MS;
  const cache: ChatContextCache = {
    chatId,
    workspaceId,
    retrievals: [],
    accumulatedChunks: new Map(),
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    ttlMs,
  };

  contextCaches.set(chatId, cache);
  return cache;
}

/**
 * Добавляет результат retrieval в кэш
 */
export function addRetrievalToCache(
  chatId: string,
  result: CachedRetrievalResult
): void {
  const cache = contextCaches.get(chatId);
  if (!cache) return;

  // Добавляем результат
  cache.retrievals.push(result);

  // Ограничиваем количество кэшированных retrieval
  if (cache.retrievals.length > MAX_CACHED_RETRIEVALS) {
    cache.retrievals.shift();
  }

  // Добавляем чанки в накопленный контекст
  for (const chunk of result.chunks) {
    if (cache.accumulatedChunks.size < MAX_ACCUMULATED_CHUNKS) {
      cache.accumulatedChunks.set(chunk.chunk_id, chunk);
    }
  }

  cache.lastAccessedAt = Date.now();
}

/**
 * Находит похожий кэшированный результат retrieval
 */
export function findSimilarCachedRetrieval(
  chatId: string,
  query: string,
  embeddingVector?: number[],
  similarityThreshold = 0.85
): CachedRetrievalResult | null {
  const cache = contextCaches.get(chatId);
  if (!cache) return null;

  // Проверяем TTL
  const now = Date.now();
  if (now - cache.lastAccessedAt > cache.ttlMs) {
    contextCaches.delete(chatId);
    return null;
  }

  // Ищем похожий запрос
  const normalizedQuery = normalizeQuery(query);

  for (const retrieval of cache.retrievals) {
    // Точное совпадение нормализованного запроса
    if (retrieval.normalizedQuery === normalizedQuery) {
      return retrieval;
    }

    // Если есть векторы — проверяем косинусное сходство
    if (embeddingVector && retrieval.embeddingVector) {
      const similarity = cosineSimilarity(embeddingVector, retrieval.embeddingVector);
      if (similarity >= similarityThreshold) {
        return retrieval;
      }
    }
  }

  return null;
}

/**
 * Получает накопленные чанки из кэша
 */
export function getAccumulatedChunks(
  chatId: string,
  limit?: number
): RagChunk[] {
  const cache = contextCaches.get(chatId);
  if (!cache) return [];

  // Проверяем TTL
  const now = Date.now();
  if (now - cache.lastAccessedAt > cache.ttlMs) {
    contextCaches.delete(chatId);
    return [];
  }

  const chunks = Array.from(cache.accumulatedChunks.values());
  
  // Сортируем по score (если есть)
  chunks.sort((a, b) => (b.score || 0) - (a.score || 0));

  return limit ? chunks.slice(0, limit) : chunks;
}

/**
 * Очищает кэш для чата
 */
export function clearCache(chatId: string): void {
  contextCaches.delete(chatId);
}

/**
 * Нормализует запрос для сравнения
 */
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * Вычисляет косинусное сходство между двумя векторами
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

// Периодическая очистка устаревших кэшей
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [chatId, cache] of contextCaches.entries()) {
      if (now - cache.lastAccessedAt > cache.ttlMs) {
        contextCaches.delete(chatId);
      }
    }
  }, 60_000); // Каждую минуту
}

# Embeddings usage entrypoint (where tokens are available)

Контекст шага 1: фиксируем точки, где считаются эмбеддинги, и где появляются токены.

## Единственная точка вызова провайдера
- `fetchEmbeddingVector` в `server/routes.ts` — общий клиент для всех вызовов эмбеддингов.
- Возвращает `{ vector, usageTokens, embeddingId, rawResponse, request }`. `usageTokens` читается из ответа провайдера (JSON-path через `extractEmbeddingResponse`).

## Где вызывается
- Векторизация документов/чанков базы знаний (ingest): блоки `vector_embedding` в пайплайне документа (см. `runKnowledgeBaseRagPipeline` и участок `embeddingResults` в `routes.ts` ~12700+). Там есть `embeddingUsageTokens` и `embeddingResultForMetadata`.
- Query-embeddings при поиске/чате (RAG запросы): `fetchEmbeddingVector` вызывается при построении вектора запроса в `runKnowledgeBaseRagPipeline` / чатовых эндпоинтах (`/api/chat/.../messages/llm`) — сохраняется в pipeline metadata, в `knowledge_base_ask_ai_runs` уже пишутся `embedding_tokens`.
- Админ/тест эндпоинты эмбеддингов сервисов (`/api/embedding/services/test-credentials`) — тоже через `fetchEmbeddingVector`, но это вспомогательные вызовы.

## Момент истины по токенам
- После завершения `fetchEmbeddingVector`: `usageTokens` уже финальные (если провайдер их вернул).
- Для ingest-пайплайна: токены доступны в `embeddingUsageTokens` рядом с чанк-результатами до записи в векторное хранилище.
- Для RAG/AskAI: итоговые токены сохраняются в `knowledge_base_ask_ai_runs.embedding_tokens/total_tokens`.

## Связка с workspace
- Векторизация документов: workspaceId приходит через knowledge base/skill контекст; каждый чанк относится к knowledge base с `workspace_id`.
- Query-embeddings в чатах/RAG: workspaceId берётся из контекста чата/skill (`buildChatLlmContext`) и передаётся при выборе embedding провайдера.
- Провайдеры эмбеддингов привязаны к workspace (`embedding_providers.workspace_id`), выбираются перед вызовом `fetchEmbeddingVector`.

## Куда пришивать учёт
- Интеграция должна происходить сразу после `fetchEmbeddingVector` (когда есть `usageTokens`, `provider`, `model`, `workspaceId`, идентификатор операции/чанка/запроса`).
- Берём поля: `tokens_total = usageTokens`, `provider`, `model`, `workspaceId`, `occurred_at` (момент завершения операции), `operation_id` (id чанка/задачи/запроса), опционально `content_bytes` (размер текста для чанка).

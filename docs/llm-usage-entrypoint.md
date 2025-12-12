# LLM usage entrypoint (where tokens are available)

Контекст: шаг 1 по учёту LLM-токенов. Ничего не считаем, фиксируем точку интеграции.

## Единая точка вызова
- `server/llm-client.ts :: executeLlmCompletion` — единственный клиент для LLM (включая стрим).
- Вызовы идут из `server/routes.ts` (чат/skills), `chat-title-generator.ts`, и сервисов STT-постпроцессинга.
- Поставщик (`provider.id`, `provider.providerType`, `completionUrl`) и `model` берутся из `LlmProvider` и запроса.

## Где появляются фактические токены
- `executeLlmCompletion` возвращает `usageTokens` (total_tokens), как только завершён ответ:
  - **Streaming AITunnel**: парсится SSE; usage берётся из `usage.total_tokens` финального сообщения (см. обработчик `handlePayload`), итог в `completion.usageTokens`.
  - **Non-streaming AITunnel**: usage из поля `usage.total_tokens` JSON-ответа.
  - **Other providers**: usage парсится через `responseConfig.usageTokensPath` или `json.usage.total_tokens` (см. блоки `usageTokens` в llm-client).
- На момент возврата промиса `executeLlmCompletion` токены уже финальные; промежуточные дельты стрима не нужны.

## Где есть связь с workspace / provider / model
- Вызов осуществляется из `server/routes.ts` с уже известным `workspaceId`, `llmProvider` и `model` (см. обработку `CALL_LLM` в чат-пайплайне).
- Skill execution лог хранит `workspaceId`/`skillId`/`userId` (таблицы `skill_executions`, `skill_execution_steps`), но **не** хранит токены — их нужно брать из результата `executeLlmCompletion`.
- Для Ask AI / RAG: таблица `knowledge_base_ask_ai_runs` уже содержит `workspace_id`, `llm_provider_id`, `llm_model`, `llm_tokens`, `total_tokens` (используется внутри `runKnowledgeBaseRagPipeline`).

## Стриминг — есть ли финальные токены?
- Да, для AITunnel стрим: `executeLlmCompletion` ждёт конец SSE, собирает `usage.total_tokens` и возвращает его как `usageTokens`. Если провайдер не прислал usage, поле будет `null`.

## Как руками проверить наличие токенов
- Локально вызвать LLM-эндпоинт (чат): `POST /api/chat/sessions/:id/messages/llm` со `stream=false` и `stream=true`.
- В логах увидеть строки `[llm] provider=... response status=...` и в ответе SSE/JSON поле `usage.total_tokens`.
- В обработчике маршрута (после `executeLlmCompletion`) токены доступны как `completion.usageTokens`; можно временно `console.info` их или в тестах прочитать ответ (`usage.llmTokens` для стрим ветки).

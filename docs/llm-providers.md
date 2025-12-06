## LLM провайдеры (Unica)

- **Где лежит список провайдеров:** `shared/schema.ts` — `llmProviderTypes` (`"gigachat" | "custom" | "aitunnel"`). Default остаётся `gigachat`.
- **Хранилище настроек:** таблица `llm_providers` (`shared/schema.ts`), поля: `providerType`, `tokenUrl`, `completionUrl`, `authorizationKey`, `scope`, `model`, `requestHeaders`, `requestConfig`, `responseConfig`, флаги `isActive`, `isGlobal`, `allowSelfSignedCertificate`.
- **Получение/выбор провайдера:** `server/storage.ts` (`list/getLlmProvider`), `server/llm-config-resolver.ts` (priorities: action → skill → workspace `unica_chat_config`), используется в пайплайнах чатов, RAG, действий.
- **Клиент LLM:** `server/llm-client.ts`
  - Вход: `LlmProvider`, access token, body (messages/systemPrompt/temperature/maxTokens/topP/presencePenalty/frequencyPenalty, custom fields), опции `{ stream?: boolean; responseFormat?: RagResponseFormat; onBeforeRequest?: () => void }`.
  - Возврат: `LlmCompletionResult` `{ answer, usageTokens?, rawResponse, request }`; при стриме `streamIterator` выдаёт события `{ event: "delta", data: { text } }`.
  - Стрим: SSE/Chunked; парсинг через `mergeLlmResponseConfig`/`getValueByJsonPath`, `forwardLlmStreamEvents` в `server/routes.ts`.
  - Заглушка для неподдержанных провайдеров: `assertLlmProviderSupported` выбрасывает `UnsupportedLlmProviderError` для `aitunnel` (реализация будет добавлена позже).
- **Формирование тела запроса:** `server/search/utils.ts#buildLlmRequestBody` (учитывает `modelField`, `messagesField`, systemPrompt, temperature, maxTokens, topP, penalties, `additionalBodyFields`).
- **OAuth:** `server/llm-access-token.ts` (client credentials, кэш токена, TLS prefs).

### AITunnel (подготовка)
- В `llmProviderTypes` добавлен `aitunnel`; существующие записи с `gigachat` не трогаются.
- `assertLlmProviderSupported` пока кидает ошибку для `aitunnel`; в следующих шагах заменить на реальный клиент.
- Настройки для AITunnel предполагаются в тех же полях `llm_providers` (apiKey через `authorizationKey`, `tokenUrl`, `completionUrl`, `model`, `requestConfig/responseConfig`).

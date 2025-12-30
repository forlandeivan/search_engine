# API Inventory (публичные точки + Bearer auth)

> Источник: `server/routes.ts` (Express), аутентификация — `Authorization: Bearer <user_token>` из профиля/личного API-токена. Все запросы требуют workspaceId (в query/body или через X-Workspace-Id/контекст сессии). Ответы об ошибках: `{ message: string, errorCode?: string, details?: unknown }`. Типовые коды: 400 валидация, 401 без токена, 403 нет прав/архив, 404 не найдено, 500 внутренняя.

## Auth
- Сессия/профиль: `GET /api/auth/session` — возвращает пользователя и активный workspace; требует Bearer.
- Bearer-токен: хранится как личный API-токен пользователя; передавать в `Authorization: Bearer <token>`. Для no-code callback используется отдельный токен навыка (см. разделы ниже).

## Чаты
- `GET /api/chat/sessions?workspaceId=...&status=all|archived&q=...` — список чатов пользователя. Headers: `Authorization: Bearer`.
- `GET /api/chat/sessions/:chatId?workspaceId=...` — детали чата.
- `POST /api/chat/sessions` body `{ workspaceId, skillId, title? }` — создать чат.
- `PATCH /api/chat/sessions/:chatId` body `{ title }` — переименовать.
- `DELETE /api/chat/sessions/:chatId?workspaceId=...` — архив/удаление.
- Ошибки: 403 `CHAT_ARCHIVED`/`SKILL_ARCHIVED` при работе с архивом.

## Сообщения
- `GET /api/chat/sessions/:chatId/messages?workspaceId=...` — история чата.
- `POST /api/chat/sessions/:chatId/messages` — отправка user-сообщения (используется внутри UI).
- `POST /api/chat/sessions/:chatId/messages/llm` — запуск LLM-ответа; Accept `text/event-stream` для стрима (SSE).
- `POST /api/chat/sessions/:chatId/messages/file` — загрузка файла (multipart/form-data, поле `file`, workspaceId в body/query). Возвращает message `{ type: "file", file: { attachmentId, filename, mimeType, sizeBytes, downloadUrl, expiresAt } }`.
- `GET /api/chat/messages/:messageId/file?workspaceId=...` — скачать файл сообщения (auth, workspace scope). downloadUrl из ответа — presigned с TTL `ATTACHMENT_URL_TTL_SECONDS` (по умолчанию 15 минут).
- No-code входящие callbacks:
  - `POST /api/no-code/callback/transcripts` body `{ workspaceId, chatId, fullText, title?, previewText?, status? }` + `Authorization: Bearer <callback_token>` или `?callbackKey=...` (лимит fullText 500k). Создаёт запись стенограммы.
  - `PATCH /api/no-code/callback/transcripts/:transcriptId` body `{ workspaceId, chatId, fullText, title?, previewText?, status? }` + bearer/ключ — обновляет стенограмму.
  - `POST /api/no-code/callback/messages` body `{ workspaceId, chatId, role, content|text, triggerMessageId?, metadata? }` + `Authorization: Bearer <callback_token>`.
  - `POST /api/no-code/callback/stream` body `{ workspaceId, chatId, triggerMessageId, streamId, chunkId, delta|text, seq?, isFinal? }` + bearer-токен навыка.
  - `POST /api/no-code/callback/assistant-action` body `{ workspaceId, chatId, actionType, actionText?, triggerMessageId?, occurredAt? }` + bearer-токен навыка.
- Исходящие события no-code:
  - `message.created` webhook (POST на сконфигурированный endpoint навыка) с полями message + `contextPack` (history в пределах contextInputLimit).
  - `file.uploaded` webhook (для no-code навыков): файл метаданные + presigned downloadUrl/expiresAt, idempotency-key `file.uploaded:<messageId>`.

## Assistant action
- Поле `currentAssistantAction` отдаётся в `GET /api/chat/sessions`. Callback для установки см. выше.

## Транскрипция/ASR
- Старт/пуллинг: `GET /api/chat/transcribe/operations/:operationId`, `POST /api/chat/transcribe/complete/:operationId` (используется UI после загрузки аудио).
- Audio upload триггерит создание операции (см. ChatInput); bearer обязателен.

## Холст/Canvas
- В сообщениях могут быть `metadata.type === "transcript"` или артефакты; выделенного публичного canvas API не найдено. TranscriptCanvas использует `/api/chat/transcribe/*` и `/api/canvas/...` не обнаружено в routes.ts (⚠️ нет публичной точки).

## LLM/Embeddings/RAG
- LLM: через `POST /api/chat/sessions/:chatId/messages/llm` (см. выше) — внутренняя orchestration, стрим SSE.
- Embeddings/RAG: публичного универсального endpoint нет; есть внутренние `/api/vector/collections`, `/api/knowledge/...` для админки/рабочей области, требуют Bearer и роли workspace.

## Ошибки/формат
- Формат ошибок единый: `{ message, errorCode?, details? }`. 401/403/404/422/500 по стандарту Express-хэндлеров.

## Пробелы/неясности
- Нет выделенного публичного API для “canvas”; используется транскрипт как message metadata.
- API генерации личного Bearer-токена пользователя не обнаружен в routes.ts (вероятно через UI/профиль).
- OpenAPI/Swagger не найдено в репозитории (нет swagger.json/route).

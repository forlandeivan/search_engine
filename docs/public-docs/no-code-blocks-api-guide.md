# No-code Blocks API Guide (черновик)

## Введение
Документ для интеграторов и no-code сценариев: как вызывать публичные точки API чата/LLM/ASR. Все примеры — с `Authorization: Bearer <user_token>` (личный API-токен пользователя). Доступ scoped по workspace.

## Auth
- Токен: личный Bearer из профиля. Передавать в `Authorization: Bearer <token>`.
- Сессия: `GET /api/auth/session` — проверка токена, получение `workspace.active.id`.
- Workspaces: передавайте `workspaceId` в query/body, если нет активного контекста.

### Пример curl
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/chat/sessions?workspaceId=ws-1"
```

## Глоссарий и связи
- Workspace — область видимости всех операций.
- Skill — конфиг обработки; режимы `standard`/`no_code`; хранит `contextInputLimit`.
- Chat — принадлежит Workspace и Skill; статус `active|archived`.
- Message — роли `user|assistant|system`; может содержать metadata (transcript, triggerMessageId, streamId).
- Assistant Action — текущее состояние ассистента (`currentAssistantAction` в Chat).
- Transcript/ASR — операции транскрибации аудио, результаты приходят как message с metadata.type `transcript`.
- ContextPack — пакет истории (history + limits) в webhook `message.created` для no-code.
- No-code callback token — bearer-токен навыка для входящих callback’ов.

Связи: Chat → Skill (1), Message → Chat (много), ContextPack строится из последних Messages с учётом `contextInputLimit`.

## Соглашения
- Время: ISO8601 строка.
- IDs: строки UUID/генерируемые.
- Ошибки: `{ message, errorCode?, details? }`.
- Пагинация: чаты и сообщения сейчас без cursor-пагинации (возвращается весь список).

## Безопасность
- Workspace scoping: все запросы с workspaceId, иначе 400/403.
- Архивные чаты/навыки: отправка сообщений запрещена (код `CHAT_ARCHIVED`/`SKILL_ARCHIVED`).
- Секреты: no-code bearer/token не возвращаются в публичных чат-эндпоинтах.

## Блоки (overview)
- Chats & Messages (готово, см. ниже)
- Assistant Action
- ASR/Transcription
- LLM stream (через chat message)
- No-code callbacks (message/stream/action)

## Chats & Messages
### Создать чат
`POST /api/chat/sessions`
```json
{ "workspaceId": "ws-1", "skillId": "skill-1", "title": "Диалог" }
```
Ответ: `{ "id": "...", "skillId": "...", "status": "active", ... }`

### Список чатов
`GET /api/chat/sessions?workspaceId=ws-1&status=all&q=...`

### История сообщений
`GET /api/chat/sessions/{chatId}/messages?workspaceId=ws-1`
Ответ: `{ "messages": [ { "id": "...", "role": "user", "content": "...", "metadata": {} } ] }`

### Отправить сообщение (user)
`POST /api/chat/sessions/{chatId}/messages`
Body: `{ "workspaceId": "ws-1", "content": "Привет" }`
Ответ 201: `{ "message": { ... } }`
Ошибки: 403 при архиве.

### Запуск LLM (assistant)
`POST /api/chat/sessions/{chatId}/messages/llm` с Accept `text/event-stream` для стрима.
Тело: `{ "workspaceId": "ws-1", "content": "Привет" }`
Ответ: SSE events `data: {"type":"delta","content":"..."}` / финальный JSON.

### Архив/удаление
`DELETE /api/chat/sessions/{chatId}?workspaceId=ws-1`

### Вложения
Отдельного публичного endpoint для upload нет в routes.ts; вложения приходят как metadata (audio/transcript). ⚠️ Требуется уточнение.

### Примеры
1) Создать чат → отправить сообщение → получить историю:
```bash
CHAT=$(curl -s -H "Authorization: Bearer $TOKEN" -X POST \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"ws-1","skillId":"skill-1","title":"Demo"}' \
  http://localhost:5000/api/chat/sessions | jq -r '.id')
curl -s -H "Authorization: Bearer $TOKEN" -X POST \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"ws-1","content":"hi"}' \
  http://localhost:5000/api/chat/sessions/$CHAT/messages
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/chat/sessions/$CHAT/messages?workspaceId=ws-1"
```
2) Архивный чат: `POST /api/chat/sessions/{chatId}/messages` → 403 `{ "message": "Чат архивирован...", "errorCode":"CHAT_ARCHIVED" }`.
3) Стрим LLM: Accept `text/event-stream` на `/api/chat/sessions/{chatId}/messages/llm`.

## Assistant Action
- Callback: `POST /api/no-code/callback/assistant-action` (Bearer callback токен навыка) с `actionType` (ANALYZING|TRANSCRIBING|TYPING, uppercase), `actionText?`, `triggerMessageId?`.
- Выдача: поле `currentAssistantAction` в `GET /api/chat/sessions`. Гасится на первом результате (message/stream).

## No-code callbacks (messages/stream)
- Создать сообщение: `POST /api/no-code/callback/messages` с `role`, `text|content`, `triggerMessageId?`, `metadata?`; требует callback Bearer.
- Стрим: `POST /api/no-code/callback/stream` с `streamId`, `chunkId`, `delta|text`, `isFinal?`, `triggerMessageId`; идемпотентность по chunkId.
- Исходящее событие: webhook `message.created` содержит `contextPack` (history в пределах `contextInputLimit` навыка).

## ASR/Transcription
- Пуллинг статуса: `GET /api/chat/transcribe/operations/{operationId}`.
- Завершение: `POST /api/chat/transcribe/complete/{operationId}` (UI вызывает после готовности).
- Старт/загрузка аудио — в UI (отдельный upload endpoint не экспонирован в routes.ts; требуется уточнение). Статусы: processing/postprocessing/ready/failed (по metadata сообщений).

## LLM/Embeddings/RAG
- LLM: через `/api/chat/sessions/{chatId}/messages/llm` (stream SSE). Ошибки: 400 валидация, 403 архив/квоты, 500 внутренняя.
- Embeddings/RAG: публичных специализированных точек нет; админ/внутренние `/api/vector/collections`, `/api/knowledge/...` требуют Bearer и права workspace.
- Модерация/классификация: публичных точек не найдено.

## File upload → no-code
- Вход: пользователь загружает файл в чат `POST /api/chat/sessions/{chatId}/messages/file` (multipart, поле `file`, `workspaceId` в body/query). Возвращает message с `type=file` и блоком `file` (attachmentId, filename, mimeType, sizeBytes, downloadUrl, expiresAt).
- Download: `downloadUrl` — presigned ссылка (TTL по умолчанию 15 мин, env `ATTACHMENT_URL_TTL_SECONDS`). Storage key наружу не отдаётся.
- Webhook `message.created`: если skill в no_code, отправляется с `type=file` и file-блоком.
- Webhook `file.uploaded`: отдельное событие после создания file-message.

### Webhook file.uploaded (no-code)
Событие уходит только при включённом no-code (skill.executionMode=no_code).
```json
{
  "schemaVersion": 1,
  "event": "file.uploaded",
  "eventId": "message-id",
  "occurredAt": "2025-01-01T12:00:00.000Z",
  "workspace": { "id": "ws-1" },
  "chat": { "id": "chat-1" },
  "skill": { "id": "skill-1" },
  "message": { "id": "message-id", "createdAt": "2025-01-01T12:00:00.000Z", "type": "file" },
  "actor": { "userId": "user-1" },
  "file": {
    "attachmentId": "attach-1",
    "filename": "report.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 123456,
    "downloadUrl": "https://...presigned...",
    "expiresAt": "2025-01-01T12:15:00.000Z",
    "uploadedByUserId": "user-1"
  },
  "meta": { "transcriptionFlowMode": "no_code" }
}
```
Идемпотентность: header `Idempotency-Key` = `file.uploaded:<messageId>`. Секреты и storageKey не передаются.

## Нерешённые вопросы
- Canvas: нет отдельного публичного API, используется transcript metadata. Если появится, добавить раздел.
```

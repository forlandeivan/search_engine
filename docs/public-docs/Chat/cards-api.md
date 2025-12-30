# Cards API (preview + content)

Карточка — это отдельный объект чата с превью в ленте и контентом для “Читать целиком”. Сообщение типа `card` ссылается на карточку через `cardId`.

## Эндпоинты и DTO (инвентаризация)
- `POST /api/no-code/callback/transcripts` — создать стенограмму по callback токену. Авторизация: `Authorization: Bearer <callbackToken>`. Поля `workspaceId`, `chatId`, `fullText` (обяз.), `title?`, `previewText?`, `status?` (`ready` по умолчанию).
- `PATCH /api/no-code/callback/transcripts/:transcriptId` — обновить текст/метаданные стенограммы (тот же токен, те же поля; `fullText` обязателен).
- `POST /api/no-code/callback/messages` — создать сообщение (в том числе `messageType=card`) из no-code сценария. Авторизация: `Authorization: Bearer <callbackToken>`. Поля `card.type`, `card.title?`, `card.previewText?`, `card.transcriptId?`; если `card` передан — создаётся `chat_card` и сообщение с `cardId`.
- `GET /api/chat/sessions/:chatId/messages` — список сообщений чата (preview в ленте). Авторизация: Bearer пользователя, `workspaceId` в query. Card-DTO: `messageType: "card"`, `cardId`, `metadata.cardId`, `metadata.transcriptId`, `content` = preview.
- `GET /api/cards/:cardId` — получить карточку для открытия контента. Авторизация: Bearer пользователя, членство в workspace. Ответ: `{ card: { id, workspaceId, chatId, type, title, previewText, transcriptId, createdAt } }`.
- Контент для транскрипта: `GET /api/transcripts/:id` и `/api/transcripts/:id/canvas-documents` (как и раньше), auth Bearer пользователя.
- Обновление/удаление карточек публичным API нет.

## Модель и связи
- Card: `{ id, workspaceId, chatId, type, title?, previewText?, transcriptId?, createdByUserId?, createdAt }`.
- Message с карточкой: `messageType="card"`, `cardId`, `content` содержит preview, `metadata` дублирует `cardId` и, для транскриптов, `transcriptId`.
- UX: превью берётся из `message.content`/`metadata.previewText`; кнопка “Читать целиком” делает `GET /api/cards/:id`, берёт `transcriptId` и открывает `/api/transcripts/:id`.

## Создание карточки (no-code callback)
1) Сначала сохраните стенограмму: `POST /api/no-code/callback/transcripts` с заголовком `Authorization: Bearer <callbackToken>` и полями `workspaceId`, `chatId`, `fullText` (+опционально `title/previewText/status`). Ограничение `fullText` — до 500 000 символов. Запомните `transcript.id`.
2) Затем отправьте карточку:
- Метод: `POST /api/no-code/callback/messages`
- Заголовки: `Authorization: Bearer <callbackToken>`; `Content-Type: application/json`
- Тело (пример транскрипт-карточки):
```json
{
  "workspaceId": "<workspace-id>",
  "chatId": "<chat-id>",
  "role": "assistant",
  "card": {
    "type": "transcript",
    "title": "Стенограмма",
    "previewText": "Краткий обзор…",
    "transcriptId": "<transcript-id>"
  },
  "metadata": {
    "defaultTabId": "transcript"
  }
}
```
- Ответ `201`: `{ message: { id, messageType: "card", cardId, content, metadata, createdAt, ... } }`
- Ограничения: `transcriptId` должен существовать и принадлежать чату/workspace. Превью разумно держать до ~200 символов (так формирует встроенный ASR). `card.type` — строка, сейчас используется `transcript`.

## Получение карточки и контента
1) Список сообщений для ленты: `GET /api/chat/sessions/:chatId/messages?workspaceId=...` → используйте `messageType`, `cardId`, `content` для превью.
2) Открытие: `GET /api/cards/:cardId?workspaceId=...` → получите `transcriptId`; далее `GET /api/transcripts/:id` для полного текста и `/api/transcripts/:id/canvas-documents` для холста.
3) Ошибки: `401/403` — нет токена или не участник workspace; `404` — карточка/транскрипт отсутствует.

## Идемпотентность и ретраи
- Для `POST /api/no-code/callback/messages` отдельного Idempotency-Key нет. При ретраях избегайте дублей на своей стороне (используйте стабильный флаг “уже отправили” или храните созданный `messageId`).
- Для stream/sync_final используется `resultId` (см. `/api/no-code/callback/stream` и sync_final), но для card create — нет встроенной дедупликации.

## Security & Access
- Все эндпоинты требуют Bearer-токен пользователя (кроме callback — там токен/ключ сценария).
- Workspace scoping: `/api/chat/sessions/:chatId/messages` и `/api/cards/:cardId` проверяют принадлежность workspace/пользователя.
- Секреты/внутренние storageKey не возвращаются; для контента используются защищённые transcript-эндпоинты под тем же Bearer.

## Quickstart (карточка транскрипта)
1) Получите `workspaceId` и `chatId` (создайте чат, если нужно).
2) Сохраните текст стенограммы: `POST /api/no-code/callback/transcripts` → получите `transcriptId`.
3) Отправьте карточку: `POST /api/no-code/callback/messages` с `card.type="transcript"` и `transcriptId`.
4) Запросите `GET /api/chat/sessions/:chatId/messages` — увидите сообщение с `messageType="card"` и `cardId`.
5) По клику “Читать целиком” дерните `GET /api/cards/:cardId`, возьмите `transcriptId`.
6) Загрузите содержимое: `GET /api/transcripts/:transcriptId` (и `/api/transcripts/:id/canvas-documents` для холста).

## Сводка эндпоинтов
- POST `/api/no-code/callback/transcripts` — создать стенограмму (callback токен/ключ).
- PATCH `/api/no-code/callback/transcripts/:id` — обновить стенограмму (callback токен/ключ).
- POST `/api/no-code/callback/messages` — создать сообщение/карточку (callback токен/ключ).
- GET `/api/chat/sessions/:chatId/messages` — список сообщений (Bearer).
- GET `/api/cards/:cardId` — карточка по id (Bearer).
- GET `/api/transcripts/:id`, `/api/transcripts/:id/canvas-documents` — контент транскрипта (Bearer).

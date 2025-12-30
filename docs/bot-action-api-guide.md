# Bot Action API Guide

**Версия:** 1.0  
**Дата:** 2025  
**Источник правды:** `shared/schema.ts` — типы `BotAction`, `BotActionType`, `BotActionStatus`

## Что такое bot_action

`bot_action` — это механизм отображения фоновой активности бота в чате. В отличие от сообщений (`message`) и карточек (`bubble`), `bot_action` показывает **строку активности** (спиннер + текст) **вне ленты сообщений**.

### Ключевые отличия:
- ❌ **НЕ создаёт сообщение** в ленте чата
- ❌ **НЕ создаёт bubble** (карточку)
- ✅ Показывает **отдельную строку индикатора** над лентой сообщений
- ✅ Автоматически скрывается при завершении (`done`/`error`)
- ✅ Восстанавливается после refresh/reconnect через GET

## Контракт BotAction

### Поля

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `workspaceId` | `string` | ✅ | ID рабочего пространства |
| `chatId` | `string` | ✅ | ID чата |
| `actionId` | `string` | ✅ | Уникальный идентификатор действия (ключ корреляции для start/update) |
| `actionType` | `BotActionType \| string` | ✅ | Тип действия (см. список ниже) |
| `status` | `"processing" \| "done" \| "error"` | ✅ | Статус действия |
| `displayText` | `string \| null` | ❌ | Кастомный текст для UI (приоритет над дефолтом) |
| `payload` | `Record<string, unknown> \| null` | ❌ | Дополнительные данные (JSON) |
| `createdAt` | `string \| null` | ❌ | Время создания (ISO 8601) |
| `updatedAt` | `string \| null` | ❌ | Время последнего обновления (ISO 8601) |

### Правила отображения текста

1. Если есть `displayText` → показываем его
2. Иначе → дефолтный текст по `actionType` (см. таблицу ниже)
3. Если `actionType` неизвестный и нет `displayText` → нейтральный fallback "Выполняем действие…"

**Важно:** `displayText` — это plain text (без HTML), макс. ~300 символов.

## Список actionType

| actionType | Дефолтный текст | Описание |
|------------|-----------------|----------|
| `transcribe_audio` | "Готовим стенограмму…" | Транскрибация аудио |
| `summarize` | "Готовим саммари…" | Создание саммари |
| `generate_image` | "Создаём изображение…" | Генерация изображения |
| `process_file` | "Обрабатываем файл…" | Обработка файла |

**Расширяемость:** `actionType` допускает произвольную строку для forward-compat. При неизвестном типе UI не падает, использует `displayText` или нейтральный fallback.

## API

### 1. Start (начало действия)

**Endpoint:** `POST /api/chat/actions/start`

**Авторизация:** Bearer token (user auth) или no-code callback token

**Request Body:**
```json
{
  "workspaceId": "workspace-123",  // опционально, если в workspaceContext
  "chatId": "chat-456",
  "actionId": "uuid-789",          // уникальный ID операции
  "actionType": "transcribe_audio",
  "displayText": "Готовим стенограмму…",  // опционально
  "payload": {                     // опционально
    "transcriptId": "transcript-123",
    "fileName": "audio.mp3"
  }
}
```

**Response (200):**
```json
{
  "action": {
    "workspaceId": "workspace-123",
    "chatId": "chat-456",
    "actionId": "uuid-789",
    "actionType": "transcribe_audio",
    "status": "processing",
    "displayText": "Готовим стенограмму…",
    "payload": { "transcriptId": "transcript-123", "fileName": "audio.mp3" },
    "createdAt": "2024-01-01T12:00:00Z",
    "updatedAt": "2024-01-01T12:00:00Z"
  }
}
```

**Поведение:**
- Создаёт или обновляет action со статусом `processing`
- Идемпотентно: повторный start с тем же `actionId` обновляет `updatedAt` и опционально `displayText`/`payload`
- Публикует realtime-событие `{ type: "bot_action", action }` в SSE канал

### 2. Update (обновление статуса)

**Endpoint:** `POST /api/chat/actions/update`

**Авторизация:** Bearer token (user auth) или no-code callback token

**Request Body:**
```json
{
  "workspaceId": "workspace-123",
  "chatId": "chat-456",
  "actionId": "uuid-789",
  "actionType": "transcribe_audio",
  "status": "done",               // "done" или "error"
  "displayText": "Готово!",       // опционально
  "payload": {                    // опционально
    "result": "transcript-id-123"
  }
}
```

**Response (200):**
```json
{
  "action": {
    "workspaceId": "workspace-123",
    "chatId": "chat-456",
    "actionId": "uuid-789",
    "actionType": "transcribe_audio",
    "status": "done",
    "displayText": "Готово!",
    "payload": { "result": "transcript-id-123" },
    "createdAt": "2024-01-01T12:00:00Z",
    "updatedAt": "2024-01-01T12:05:00Z"
  }
}
```

**Поведение:**
- Обновляет статус action на `done` или `error`
- Идемпотентно: повторный update с тем же статусом безопасен
- Если action уже `done`/`error`, повторный start **не откатывает** назад в `processing`
- Публикует realtime-событие при изменении статуса

**Ошибки:**
- `404`: если `actionId` не найден (update до start)

### 3. GET (восстановление активных действий)

**Endpoint:** `GET /api/chat/actions?workspaceId=...&chatId=...&status=processing`

**Авторизация:** Bearer token (user auth)

**Query Parameters:**
- `workspaceId` (опционально, если в workspaceContext)
- `chatId` (обязательно)
- `status` (опционально, по умолчанию `"processing"`)

**Response (200):**
```json
{
  "actions": [
    {
      "workspaceId": "workspace-123",
      "chatId": "chat-456",
      "actionId": "uuid-789",
      "actionType": "transcribe_audio",
      "status": "processing",
      "displayText": "Готовим стенограмму…",
      "payload": { "transcriptId": "transcript-123" },
      "createdAt": "2024-01-01T12:00:00Z",
      "updatedAt": "2024-01-01T12:00:00Z"
    }
  ]
}
```

**Поведение:**
- Возвращает список активных actions (по умолчанию `status="processing"`)
- Сортировка: по `updatedAt` desc
- Используется для восстановления индикатора после refresh/reconnect

### 4. No-code Callbacks

**Endpoints:**
- `POST /api/no-code/callback/actions/start`
- `POST /api/no-code/callback/actions/update`

**Авторизация:** `Authorization: Bearer <callback_token>` или `?callbackKey=...`

**Request Body:** такой же, как для обычных endpoints, но `workspaceId` обязателен

**Поведение:**
- Проверяется `callbackToken` → привязка к `workspaceId` и `chatId`
- Нельзя подсветить чужой чат (проверка принадлежности)
- Остальное поведение идентично обычным endpoints

## Правила поведения

### 1. Долгоживущая активность без heartbeat

- ✅ Action висит в `processing` **сколько нужно** (хоть 30 минут)
- ✅ UI крутит спиннер сам, серверное состояние в БД
- ❌ **НЕ переотправляйте** `start` каждые 5 секунд — это не heartbeat-модель
- ✅ Вызовите `start` один раз → выполните задачу → вызовите `update(done|error)` один раз

### 2. Восстановление после refresh/reconnect

- При монтировании чата фронт делает `GET /api/chat/actions?chatId=...` и восстанавливает активные `processing`
- При переподключении SSE фронт повторяет GET, чтобы "догнать" пропущенные update
- Realtime (SSE) ускоряет доставку, но GET — источник восстановления

### 3. Идемпотентность и out-of-order

**Start (processing) правила:**
- Если state отсутствует → создать `processing`
- Если state уже `processing` → обновить `updatedAt` и опционально `displayText`/`payload`
- Если state уже `done`/`error` → **НЕ откатывать** назад (вернуть существующее, игнорировать)

**Update (done/error) правила:**
- Если state `processing` → переводим в `done`/`error`
- Если state уже `done`/`error` с тем же статусом → идемпотентно (no-op)
- Если state уже `done`, а пришёл `error` (или наоборот) → **"первое завершение победило"** (игнорировать)

**Out-of-order защита:**
- Если `update` пришёл раньше `start` → **404 "unknown actionId"** (строго) + клиент должен сначала сделать `start`

### 4. Конкуренция активностей в одном чате

- UI показывает **максимум одну строку** активности
- `currentAction` выбирается среди `processing` по самому свежему `updatedAt`
- Late update старого action не должен скрыть новый

### 5. Watchdog / timeout защита

- Максимальная длительность `processing` — **2 часа** (настраивается через `BOT_ACTION_MAX_PROCESSING_HOURS`)
- Watchdog проверяет actions каждые 30 минут и переводит "зависшие" в `error` со статусом `timeout`
- Это **НЕ ограничение** легитимных задач: 30-минутные операции работают без проблем
- При переводе в timeout публикуется realtime-событие → фронт сразу скрывает индикатор

## Рекомендации для no-code

### Как выбирать actionType

| Сценарий | actionType |
|----------|------------|
| Обработка аудио | `transcribe_audio` |
| Создание саммари | `summarize` |
| Генерация картинки | `generate_image` |
| Обработка файла (остальное) | `process_file` |

### Как задавать текст

- Используйте `displayText` в `start` (и опционально в `update`)
- Формулировка: коротко, 1 строка, без HTML
- Лимит: ~300 символов
- Если текст пустой после очистки — игнорируется, используется дефолт

### Как генерировать actionId

- ✅ Используйте **UUID на стороне no-code/клиента** для гарантии уникальности
- ✅ Один `actionId` = одна операция (start → update)
- ❌ Не переиспользуйте один `actionId` для разных задач

### Anti-patterns (очень важно)

- ❌ **Не слать** heartbeat/start каждые N секунд
- ❌ **Не создавать** сообщения "подождите…" в ленте
- ❌ **Не переиспользовать** один `actionId` для разных задач
- ❌ **Не откатывать** done/error назад в processing

### Рецепты (cookbook)

#### Рецепт 1: Транскрибируем аудио

```bash
# 1. Start
POST /api/no-code/callback/actions/start
{
  "workspaceId": "ws-1",
  "chatId": "chat-1",
  "actionId": "transcribe-123",
  "actionType": "transcribe_audio",
  "displayText": "Готовим стенограмму…"
}

# 2. Выполняем транскрипцию (долго)...

# 3. Update (done)
POST /api/no-code/callback/actions/update
{
  "workspaceId": "ws-1",
  "chatId": "chat-1",
  "actionId": "transcribe-123",
  "actionType": "transcribe_audio",
  "status": "done",
  "payload": { "transcriptId": "transcript-456" }
}

# 4. Отправляем результат (через /api/no-code/callback/transcripts или /api/no-code/callback/messages)
```

#### Рецепт 2: Обрабатываем файл с ошибкой

```bash
# 1. Start
POST /api/no-code/callback/actions/start
{
  "workspaceId": "ws-1",
  "chatId": "chat-1",
  "actionId": "process-789",
  "actionType": "process_file",
  "displayText": "Обрабатываем файл…"
}

# 2. Ошибка при обработке

# 3. Update (error)
POST /api/no-code/callback/actions/update
{
  "workspaceId": "ws-1",
  "chatId": "chat-1",
  "actionId": "process-789",
  "actionType": "process_file",
  "status": "error",
  "displayText": "Не удалось обработать файл"
}

# 4. Отправляем сообщение об ошибке (через /api/no-code/callback/messages)
```

#### Рецепт 3: Параллельные задачи

**Рекомендация:** завершайте старую задачу, если запускаете новую:

```bash
# 1. Start задача 1
POST /api/no-code/callback/actions/start
{ "actionId": "task-1", ... }

# 2. Пользователь запустил новую задачу → завершаем старую
POST /api/no-code/callback/actions/update
{ "actionId": "task-1", "status": "done" }

# 3. Start задача 2
POST /api/no-code/callback/actions/start
{ "actionId": "task-2", ... }
```

## Troubleshooting / частые ошибки

### Ошибка 404 "Действие с actionId '...' не найдено"

**Причина:** `update` вызван до `start` (out-of-order)

**Решение:** сначала вызовите `start`, затем `update`

### Индикатор не появляется

**Проверьте:**
1. `start` вернул 200?
2. `workspaceId` и `chatId` корректны?
3. Фронт подписан на SSE события?
4. После refresh фронт делает GET для восстановления?

### Индикатор не скрывается после update(done)

**Проверьте:**
1. `update` вернул 200?
2. Realtime-событие опубликовано? (проверьте SSE канал)
3. Фронт обрабатывает событие `type="bot_action"`?

### Дублирование actions

**Причина:** переиспользование `actionId` для разных задач

**Решение:** генерируйте новый UUID для каждой новой операции

### Action завис в processing

**Причина:** воркер упал, не вызвал `update(error)`

**Решение:** watchdog автоматически переведёт в `error:timeout` через 2 часа. Для быстрого исправления вызовите `update(error)` вручную.

## Quickstart (2–3 коротких сценария)

### Сценарий 1: Транскрибация аудио (минимальный)

```bash
# Start
curl -X POST http://localhost:5000/api/no-code/callback/actions/start \
  -H "Authorization: Bearer YOUR_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-1",
    "chatId": "chat-1",
    "actionId": "transcribe-123",
    "actionType": "transcribe_audio"
  }'

# ... выполняем транскрипцию ...

# Update (done)
curl -X POST http://localhost:5000/api/no-code/callback/actions/update \
  -H "Authorization: Bearer YOUR_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-1",
    "chatId": "chat-1",
    "actionId": "transcribe-123",
    "actionType": "transcribe_audio",
    "status": "done"
  }'
```

### Сценарий 2: С кастомным текстом

```bash
# Start с displayText
curl -X POST http://localhost:5000/api/no-code/callback/actions/start \
  -H "Authorization: Bearer YOUR_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-1",
    "chatId": "chat-1",
    "actionId": "process-456",
    "actionType": "process_file",
    "displayText": "Анализируем документ..."
  }'

# Update с другим текстом
curl -X POST http://localhost:5000/api/no-code/callback/actions/update \
  -H "Authorization: Bearer YOUR_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ws-1",
    "chatId": "chat-1",
    "actionId": "process-456",
    "actionType": "process_file",
    "status": "done",
    "displayText": "Готово!"
  }'
```

### Сценарий 3: Восстановление после refresh

```bash
# Фронт делает GET при монтировании чата
curl -X GET "http://localhost:5000/api/chat/actions?workspaceId=ws-1&chatId=chat-1" \
  -H "Authorization: Bearer USER_TOKEN"

# Ответ содержит активные processing actions
{
  "actions": [
    {
      "actionId": "transcribe-123",
      "actionType": "transcribe_audio",
      "status": "processing",
      ...
    }
  ]
}
```

## Чеклист "что должно быть в доке, чтобы новый человек за 10 минут подключился"

- ✅ Что такое bot_action (и что это НЕ message/bubble)
- ✅ Контракт BotAction (поля + статусы)
- ✅ actionType список
- ✅ API (start/update/GET + no-code callback варианты)
- ✅ Правила поведения (без heartbeat, восстановление, идемпотентность, конкуренция)
- ✅ Рекомендации для no-code (как генерировать actionId, когда слать start/update, displayText)
- ✅ Troubleshooting / частые ошибки
- ✅ Quickstart (2–3 коротких сценария)
- ✅ Версия/дата документа (или ссылка на источник типов)

## Ссылки

- **Источник правды типов:** `shared/schema.ts`
- **Контракт и детали:** `docs/bot-action-contract.md`
- **Правила конкуренции:** `docs/bot-action-competition-design.md`
- **Машина состояний:** `server/bot-action-state-machine.ts`


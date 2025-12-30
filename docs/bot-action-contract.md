# Bot Action Contract (source of truth)

## Где храним контракт
- Источник правды для типов: `shared/schema.ts` — экспортированы `BotAction`, `BotActionType`, `BotActionStatus`, `botActionTypes`.
- Валидируем входы на бэке через zod/ручные схемы на основе этих типов (как принято в routes); фронт подтягивает типы из `@shared/schema` (как уже делается для `AssistantActionType`).
- Реалтайм события чата идут через SSE `/api/chats/:chatId/events` с payload `{ type: "message", message }`. Для bot_action публикуем `{ type: "bot_action", action }` в тот же канал; GET `/api/chat/actions?workspaceId&chatId` остаётся для восстановления.
- Машина состояний: `server/bot-action-state-machine.ts` — централизованная логика идемпотентности и переходов состояний.

## Контракт BotAction
```ts
type BotActionStatus = "processing" | "done" | "error";
type BotActionType = "transcribe_audio" | "summarize" | "generate_image" | "process_file";

type BotAction = {
  workspaceId: string;
  chatId: string;
  actionId: string;              // корреляция start/update
  actionType: BotActionType | string; // допускаем произвольную строку для forward-compat
  status: BotActionStatus;
  displayText?: string | null;   // приоритетный текст для UI
  payload?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};
```
- UI правило: если `displayText` есть — показываем его; иначе дефолт по `actionType`; если тип неизвестен и текста нет — нейтральный fallback “Выполняем действие…”.

## Маппинг actionType → дефолтный текст (фронт, единое место)
- `transcribe_audio` → “Готовим стенограмму…”
- `summarize` → “Готовим саммари…”
- `generate_image` → “Создаём изображение…”
- `process_file` → “Обрабатываем файл…”
- unknown → “Выполняем действие…” (если нет displayText).
- displayText: optional, трим, без HTML, макс ~300 символов; если после очистки пусто — игнорируем.

## Расширяемость / анти-рассинхрон
- Добавление нового `actionType`: сначала обновить `shared/schema.ts` (`botActionTypes`), затем пополнить фронтовый маппинг текстов; если фронт не обновлён, сервер может прислать `displayText`, UI не ломается.
- Контрактные проверки: тесты на валидацию схемы (required поля, допустимые статусы), тест фронтового маппинга против `botActionTypes`.

## Долгоживущие действия без heartbeat

### Правило "без переотправок"
- Action считается активным, если `status="processing"`.
- Action остаётся активным **до явного** `update(done|error)`.
- **НЕ переотправляйте** `start` каждые N секунд — это не heartbeat-модель.
- UI спиннер крутится сам, серверное состояние хранится в БД.

### Восстановление после refresh/reconnect
- **Cold start recovery**: при монтировании чата фронт делает `GET /api/chat/actions?workspaceId&chatId` и восстанавливает активный processing.
- **Reconnect recovery**: при переподключении SSE фронт повторяет GET, чтобы "догнать" пропущенные update.
- GET возвращает список активных `processing` actions, отсортированных по `updatedAt desc`.

### Идемпотентность и out-of-order

#### Правила идемпотентности (машина состояний)

**Start (processing) правила:**
- Если state отсутствует → создать processing
- Если state уже processing → обновить `updatedAt` и (опционально) `displayText`/`payload` если изменились
- Если state уже done/error → **НЕ откатывать** назад в processing (вернуть существующее состояние, игнорировать)

**Update (done/error) правила:**
- Если state processing → переводим в done/error
- Если state уже done/error с тем же статусом → идемпотентно (no-op, если нет изменений в displayText/payload)
- Если state уже done, а пришёл error (или наоборот) → **"первое завершение победило"** (игнорировать)

**Out-of-order защита:**
- Если update пришёл раньше start (из-за гонки/ретраев) → **404 "unknown actionId"** (строго) + клиент должен сначала сделать start
- Поведение одинаковое для обычных и no-code endpoints

**Realtime публикация:**
- Событие публикуется только если состояние реально изменилось (status изменился или displayText/payload изменились)
- Игнорированные переходы не публикуются в realtime (защита от спама)

#### Рекомендации по генерации actionId
- Используйте **UUID на стороне клиента/no-code** для гарантии уникальности
- Один actionId = одна операция (start → update)
- Не переиспользуйте actionId для разных операций

#### Примеры безопасных ретраев

**Пример 1: Start ретрай 3 раза**
```bash
POST /api/chat/actions/start
{ "actionId": "uuid-123", "actionType": "transcribe_audio", ... }
# Результат: один processing action в БД

POST /api/chat/actions/start  # ретрай
{ "actionId": "uuid-123", "actionType": "transcribe_audio", ... }
# Результат: тот же processing, updatedAt обновлён

POST /api/chat/actions/start  # ещё ретрай
{ "actionId": "uuid-123", "actionType": "transcribe_audio", ... }
# Результат: тот же processing, updatedAt обновлён
```

**Пример 2: Update ретрай**
```bash
POST /api/chat/actions/update
{ "actionId": "uuid-123", "status": "done", ... }
# Результат: status = done

POST /api/chat/actions/update  # ретрай
{ "actionId": "uuid-123", "status": "done", ... }
# Результат: status = done (идемпотентно, без побочек)
```

**Пример 3: Start после done (не откатывает)**
```bash
POST /api/chat/actions/update
{ "actionId": "uuid-123", "status": "done", ... }
# Результат: status = done

POST /api/chat/actions/start  # попытка откатить
{ "actionId": "uuid-123", "actionType": "transcribe_audio", ... }
# Результат: status остаётся done (не откатывается)
```

**Пример 4: Update до start (404)**
```bash
POST /api/chat/actions/update
{ "actionId": "uuid-123", "status": "done", ... }
# Результат: 404 "Действие с actionId 'uuid-123' не найдено. Сначала вызовите start."
```

### Watchdog / timeout защита
- **Проблема**: если воркер упал, action может остаться в `processing` навсегда.
- **Решение**: периодический watchdog (`server/bot-action-watchdog.ts`) переводит "зависшие" processing в `error` со статусом `timeout`.
- **Правило**: максимальная длительность processing — **2 часа** (по умолчанию, настраивается через `BOT_ACTION_MAX_PROCESSING_HOURS`).
  - Это **НЕ ограничение** легитимных задач: 30-минутные операции работают без проблем.
  - Это страховка от сбоев.
- Watchdog проверяет actions каждые 30 минут (настраивается через `BOT_ACTION_WATCHDOG_INTERVAL_MINUTES`).
- При переводе в timeout публикуется realtime-событие → фронт сразу скрывает индикатор.

### Правила для интеграций и no-code
- ✅ **Делайте**: вызовите `start` один раз в начале → выполните задачу → вызовите `update(done|error)` один раз в конце.
- ❌ **Не делайте**: не переотправляйте `start` каждые 5 секунд, не дёргайте update без изменений.
- Если задача длится 30+ минут — это нормально, UI висит, watchdog не трогает.
- Если задача падает — обязательно вызовите `update(error)`, иначе watchdog сам переведёт в timeout через 2 часа.

## Чеклист проверки "единый контракт"
- `shared/schema.ts` содержит `BotAction`, `botActionTypes`, `botActionStatuses`.
- Фронт импортирует типы из `@shared/schema`, а не держит копии.
- Дефолтные тексты лежат в одном файле (botAction helper), покрыты тестами.
- Событие realtime/GET возвращает `BotAction` и не создаёт message bubble.
- Канал доставки: SSE событие `type="bot_action"` работает, GET даёт актуальные processing-действия; неизвестный actionType отображается через displayText/нейтральный текст.
- displayText приоритезируется; валидация длины/очистка (без HTML) на бэке.
- Watchdog активен: зависшие processing переводятся в error:timeout через 2 часа.
- Фронт восстанавливает индикатор при mount и reconnect через GET.

# Processing Bubbles Cleanup Plan (План вычищения processing-баблов)

## Цель
Полностью убрать пузырьки ожидания из ленты сообщений и оставить единственный паттерн — строку активности через `bot_action`.

## Инвентаризация источников processing-баблов

### 1. Фронтенд: создание placeholder сообщений

#### `client/src/pages/ChatPage.tsx` (строки 728-740)
- **Где**: функция `handleTranscription`
- **Что**: создаёт локальный placeholder message с `metadata.type="transcript"` и `transcriptStatus="processing"`
- **Текст**: `"Идёт расшифровка аудиозаписи..."`
- **Триггер**: загрузка аудио через `handleTranscription`
- **Замена**: уже используется `showBotAction` для показа активности, нужно убрать создание placeholder message

#### `client/src/components/chat/ChatMessagesArea.tsx` (строки 271-275)
- **Где**: фильтр сообщений перед рендером
- **Что**: уже фильтрует `isTranscriptPlaceholder` с `transcriptStatus === "processing" || "postprocessing"`
- **Статус**: ✅ Уже работает, но нужно убедиться что все processing сообщения фильтруются

#### `client/src/components/chat/ChatMessagesArea.tsx` → `TranscriptCard` (строки 527-531)
- **Где**: компонент `TranscriptCard`
- **Что**: показывает "Подождите, готовим стенограмму" для `status === "processing" || "postprocessing"`
- **Проблема**: это не должно показываться, так как такие сообщения уже фильтруются, но если какое-то попало - покажет processing UI
- **Замена**: убрать ветку `isProcessing` или оставить только для готовых transcripts (ready)

### 2. Бэкенд: создание placeholder сообщений

#### `server/routes.ts` (строки 14588-14601)
- **Где**: POST `/api/transcribe` endpoint
- **Что**: создаёт placeholder message в БД с `transcriptStatus: "processing"` и контентом `"Аудиозапись загружена. Идёт расшифровка..."`
- **Триггер**: загрузка аудио через API
- **Замена**: убрать создание placeholder message, оставить только `bot_action start`

### 3. No-code рантайм
- **Статус**: проверено - no-code использует `bot_action` API, не создаёт placeholder messages напрямую
- **Примечание**: no-code может создавать сообщения через callback API, но они должны быть готовыми результатами, не processing

## План вычищения

### Шаг 1: Фронтенд - убрать создание placeholder messages
- [x] `ChatMessagesArea.tsx` уже фильтрует processing placeholders ✅
- [ ] Убрать создание placeholder message в `ChatPage.tsx` → `handleTranscription`
- [ ] Убрать/обновить `TranscriptCard` чтобы не показывать processing UI (или оставить только для готовых)

### Шаг 2: Бэкенд - убрать создание placeholder messages
- [ ] Убрать создание placeholder message в `server/routes.ts` → POST `/api/transcribe`
- [ ] Убедиться что `bot_action start` уже вызывается (проверить)

### Шаг 3: Регресс-гарды
- [ ] Тест: при активном bot_action (processing) message list не меняется
- [ ] Тест: старт транскрипции не создаёт message с processing статусом
- [ ] Строковой гард: проверка на литералы "Подождите, готовим стенограмму" и т.п.

### Шаг 4: Финальная проверка
- [ ] Удалить мёртвые константы/переводы
- [ ] Обновить документацию
- [ ] Ручная проверка всех сценариев

## Важные замечания

1. **Готовые результаты не трогаем**: карточки готовых transcripts (status="ready") должны продолжать показываться как раньше
2. **BotActionIndicatorRow уже работает**: строка активности уже подключена и показывает processing через bot_action
3. **Фильтрация уже есть**: `ChatMessagesArea` уже фильтрует processing placeholders, но нужно убедиться что бэкенд их не создаёт

## Чеклист проверки

### Ручная проверка после вычищения:
- [ ] Загрузка аудио → нет bubble в ленте, есть строка активности
- [ ] Долгая транскрипция → строка активности висит, bubble нет
- [ ] Готовая транскрипция → карточка появляется как раньше
- [ ] Ошибка транскрипции → строка активности показывает ошибку, bubble нет
- [ ] Refresh/reconnect → строка активности восстанавливается
- [ ] История сообщений чистая (нет processing messages)


# Bot Action Indicator (строка активности чата)

## Текущее устройство чата
- Лента сообщений и карточек рендерится в `client/src/components/chat/ChatMessagesArea.tsx`, инпут — `client/src/components/chat/ChatInput.tsx` (оба подключены на `ChatPage`).
- Источник данных: `useChatMessages` (React Query) + SSE `/api/chats/:chatId/events` для новых сообщений; локальные стримы собираются в `ChatPage.streamMessage` через `sendChatMessageLLM`.
- Ассистентский action сейчас берётся из `currentAssistantAction` чата (`useChats` → `ChatPage` → `ChatMessagesArea`, Sparkles-блок). Плейсхолдер транскрипции показывает Loader, если `message.metadata.type === "transcript"` и `status processing/postprocessing` (`TranscriptCard` внутри `ChatMessagesArea`).

## Контракт bot_action event (не сообщение и не bubble)
Отдельные события/записи, которые не попадают в историю сообщений и не превращаются в bubble.

```ts
type BotActionStatus = "processing" | "done" | "error";
type BotActionType = "transcribe_audio" | "summarize" | "generate_image" | "process_file";

type BotActionEvent = {
  workspaceId: string;
  chatId: string;
  actionId: string;           // корреляция start/update
  actionType: BotActionType;
  status: BotActionStatus;    // start → processing; update → done/error
  payload?: {
    fileName?: string;
    mimeType?: string;
    progressPercent?: number | null;
    previewText?: string;
    error?: string | null;
  };
  updatedAt: string;          // ISO, используется для выбора «последнего» события
};
```
- Событие приходит как отдельный `bot_action`, фронт не создаёт сообщение/карточку.
- Для одного `chatId` может быть несколько активных `processing` actions одновременно (разные `actionId`).
- UI показывает одну строку — самую "свежую" активность (по `updatedAt`), остальные остаются в состоянии.
- Подробнее: см. `docs/bot-action-competition-design.md`.

## actionType и тексты в UI
- `transcribe_audio` → «Готовим стенограмму…»
- `summarize` → «Готовим саммари…»
- `generate_image` → «Создаём изображение…»
- `process_file` → «Обрабатываем файл…»
- Неизвестный тип: не показываем (или текст из payload, если добавим позже).

## UI/состояние на фронте
- Добавляем `BotActionIndicatorRow` вне ленты сообщений (предпочтительно над `ChatInput` на `ChatPage`, можно под заголовком при необходимости).
- Отображение:
  - `processing` — строка со спиннером + текст по `actionType`.
  - `done`/`error` — короткое подтверждение «Готово»/«Ошибка» ~1.5–2 c, затем скрываем.
  - Опционально: счётчик "+N" если активных actions больше одного.
- Состояние: храним список всех активных `processing` actions по `chatId`, вычисляем `currentAction` селектором по правилу конкуренции (самый свежий `updatedAt`).
- Обновляется из bot_action событий (SSE) или через GET `/api/chat/actions?workspaceId&chatId` (polling fallback).
- Правило конкуренции: показываем одну строку — самую "свежую" активность; остальные остаются в состоянии для переключения при завершении текущей.

## No-code правило (маппинг типов входа → actionType)
- `audio/*` → `transcribe_audio`
- `image/*` → `process_file` (или `generate_image`, если реально генерация)
- прочее → `process_file`
Правило живёт на бэке/no-code, фронт не угадывает тип.

## Чеклист ручной проверки
- ✅ Подписать чат на bot_action событие (или дернуть GET stub) и убедиться, что строка появляется вне ленты.
- ✅ Старт `processing` → строка со спиннером и корректным текстом по типу.
- ✅ `update done/error` по тому же `actionId` → короткое подтверждение и скрытие, лента сообщений не меняется.
- ✅ Параллельный start нового action заменяет предыдущий, нет «пузырей» с транскрипцией.
- ✅ **Важно**: никаких placeholder messages в ленте для processing статусов — только строка активности.

## Запрет processing-баблов

**Правило**: процесс ожидания показывается **ТОЛЬКО** через `bot_action` → `BotActionIndicatorRow`. 

**Запрещено**:
- ❌ Создавать placeholder messages с `transcriptStatus="processing"` или `"postprocessing"`
- ❌ Показывать processing UI в карточках/баблах в ленте сообщений
- ❌ Добавлять "Подождите, готовим..." тексты в сообщения

**Разрешено**:
- ✅ Показывать готовые результаты (transcripts с `status="ready"`) в ленте
- ✅ Использовать `bot_action` для показа процесса ожидания
- ✅ Показывать ошибки через `bot_action` с `status="error"`

См. `docs/processing-bubbles-inventory.md` для деталей.

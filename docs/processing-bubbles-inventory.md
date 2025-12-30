# Processing bubbles в чате — инвентаризация и план замены

## Где сейчас рисуются “processing-баблы”
- `client/src/pages/ChatPage.tsx`: при загрузке аудио создаётся placeholder-сообщение ассистента с `metadata.type="transcript"` и `transcriptStatus="processing"`, контент `"Идёт расшифровка аудиозаписи..."`.
- `client/src/components/chat/ChatMessagesArea.tsx` → `TranscriptCard`: если `metadata.transcriptStatus` в `processing/postprocessing`, рендерился блок «Транскрипция аудиофайла / Подождите, готовим стенограмму».
- `ChatMessagesArea` (ранее): ветка `isTranscribingBubble` показывала Loader с текстом «Идёт расшифровка ответа» на последнем ассистентском сообщении без контента.
- Дополнительно: верхний баннер ассистентского действия (`assistantAction.type === "TRANSCRIBING"`) — это не бабл, остаётся как статус ассистента, но не используется для показа процесса транскрипции.

## План замены (этот эпик)
- Убрать рендер processing-веток в ленте (transcript placeholders, isTranscribing bubble).
- Оставить реальные результаты (готовые transcripts/cards) без изменений.
- Показ ожидания переносим в строку активности `BotActionIndicatorRow` (см. `client/src/components/chat/BotActionIndicatorRow.tsx`), размещённую рядом с input.
- Управление на этом шаге локальное (в `ChatPage`), далее подключаемся к bot_action событиям.

## Где показываем новую строку
- `ChatPage` над `ChatInput` (внизу экрана чата), вне ленты сообщений, не влияет на прокрутку истории.

## Чеклист воспроизведения текущих сценариев (до/во время миграции)
- Загрузка аудио → появляется placeholder transcript с `transcriptStatus=processing` (было баблом, теперь скрываем).
- Долгая транскрипция → раньше показывался `isTranscribing` bubble «Идёт расшифровка ответа» на последнем сообщении; теперь ожидание должно отображаться строкой активности.
- Баннер ассистента `TRANSCRIBING` остаётся (информирует о состоянии ассистента, но не рисует bubble в ленте).

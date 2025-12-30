# Processing bubbles в чате — инвентаризация и план замены

## ✅ Статус: Выполнено

Все processing-баблы удалены. Процесс показывается только через `bot_action` → `BotActionIndicatorRow`.

## Где были "processing-баблы" (удалено)

### Фронтенд (удалено):
- ❌ `client/src/pages/ChatPage.tsx`: создание placeholder-сообщения с `transcriptStatus="processing"` — **удалено**
- ❌ `client/src/components/chat/ChatMessagesArea.tsx` → `TranscriptCard`: показ "Подождите, готовим стенограмму" для processing — **удалено**
- ✅ `ChatMessagesArea`: фильтрация processing/postprocessing messages — **работает**

### Бэкенд (удалено):
- ❌ `server/routes.ts` POST `/api/transcribe`: создание placeholder message — **удалено, заменено на bot_action start**

## Текущее состояние

### Единственный паттерн: bot_action → BotActionIndicatorRow
- Процесс показывается только через строку активности `BotActionIndicatorRow` (над `ChatInput`)
- Лента сообщений содержит только реальные сообщения/карточки результатов
- Готовые transcripts (status="ready") показываются как раньше

### Правила:
1. **Никаких placeholder messages** в ленте для processing/postprocessing статусов
2. **BotActionIndicatorRow** показывает активность через `bot_action` события
3. **Готовые результаты** (transcripts, cards) отображаются в ленте как раньше

## Чеклист проверки

### ✅ Ручная проверка:
- [x] Загрузка аудио → нет bubble в ленте, есть строка активности
- [x] Долгая транскрипция → строка активности висит, bubble нет
- [x] Готовая транскрипция → карточка появляется как раньше
- [x] Ошибка транскрипции → строка активности показывает ошибку, bubble нет
- [x] Refresh/reconnect → строка активности восстанавливается
- [x] История сообщений чистая (нет processing messages)

### ✅ Тесты:
- [x] `tests/client/chat-messages-area-transcript-placeholder.test.tsx` — проверяет, что processing/postprocessing не рендерятся
- [x] `tests/transcribe-no-placeholder-message.test.ts` — проверяет, что бэкенд не создаёт placeholder messages

## Регресс-гарды

1. **Фронтенд тест**: processing/postprocessing messages фильтруются и не рендерятся
2. **Бэкенд тест**: транскрипция не создаёт placeholder messages, только bot_action
3. **Строковой гард**: комментарии в коде и документации предупреждают о запрете placeholder messages

## Документация

См. также:
- `docs/bot-action-indicator.md` — описание BotActionIndicatorRow
- `docs/bot-action-contract.md` — контракт bot_action
- `docs/bot-action-competition-design.md` — правило конкуренции активностей
- `docs/processing-bubbles-cleanup-plan.md` — план вычищения (выполнен)

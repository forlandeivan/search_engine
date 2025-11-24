# Подготовка автогенерации названий чатов

Цель: понять, куда врезаться, чтобы после первого пользовательского сообщения автоматически придумать название чата (логика как у ChatGPT, но через системный навык Unica Chat). Этот документ описывает текущую модель, точки расширения и требования.

## 1. Где хранятся чаты и их названия
- **Таблица `chat_sessions`** — объявлена в `shared/schema.ts` (строки ~753‑770). Поле `title` — `text NOT NULL DEFAULT ''`. Дополнительно есть `created_at`, `updated_at`, `deleted_at`.
- **Сущность `ChatSession`** на сервере (`server/storage.ts`) возвращается как тип: см. `listChatSessions` (строки ~4310‑4333). Здесь же в выборку добавляются `skillName`, `skillIsSystem`, `skillSystemKey`.
- **Создание чата** — `createChatSession` (`server/storage.ts` ~4375). `title` туда попадает из `chat-service.createChat`.
- **Заполнение названия**:
  - По умолчанию `title` пустая строка (`""`), т.е. «новый» чат фактически без имени.
  - Пользователь может вручную задать имя через `PATCH /api/chat/sessions/:id` (`renameChat`). На фронте это делается из `ChatSidebar` -> `useRenameChat`.
  - Автогенерации пока нет; всё управление — руками пользователя.
- **Вывод в UI** — `ChatPage` (`client/src/pages/ChatPage.tsx`): если `chat.title` пустой, показывается fallback «Recent conversation» / «Start a new conversation» (см. `chatTitle` расчёт).  
→ Поле для названия уже есть, оно подходит для автогенерации (text, nullable=false). Дополнительных колонок не требуется.

## 2. Как определить «первое сообщение»
- **Создание чата**:
  - Фронт: `client/src/pages/ChatPage.tsx` → `handleSend`. Если `effectiveChatId` отсутствует, вызывается `createChat` (через `useCreateChat` → `POST /api/chat/sessions`).
  - После успешного создания запускается `streamMessage(newChat.id, content)` — то же, что и для существующего чата.
- **Сохранение сообщения**:
  - Маршрут `POST /api/chat/sessions/:id/messages/llm` (см. `server/routes.ts` — блок `chat` рядом с `sendChatMessageLLM`). После валидации вызывается `addUserMessage` (`server/chat-service.ts`), затем запускается LLM стрим.
  - В `addUserMessage` (строки ~213‑230) создаётся запись в `chat_messages`, а `touchChatSession` обновляет `updated_at`.
- **Где можно внедрить автоген**:
  1. После `createChat` на фронте мы знаем `chatId` и текст первого сообщения — но лучше делать это на бэке, чтобы избежать гонок.
  2. В `server/routes.ts` после `addUserMessage` мы имеем:
     - `chatId`,
     - текст первого сообщения (`content`),
     - текущий `chat.title` (через `getChatById`/`getOwnedChat`).
  3. На этом этапе можно поставить хук: если `chat.title` пустой и количество сообщений в `chat_messages` для чата = 1 → запускаем отложенную задачу `generateChatTitle`.

## 3. Требования к названию
- Лимит: **до 5 слов** (~60 символов). Главное — короткое, ёмкое описание темы.
- Используем человеческий язык (тот же, что и у пользователя); в промпте попросим Unica Chat вернуть краткий заголовок без пунктуации в конце.
- **Не перезаписывать ручные названия**:
  - Автогенируем только если `chat.title` равен `""` (или равно дефолту).
  - Как только пользователь переименовал чат, любой дальнейший автоген должен игнорироваться.
- Название сохраняется в `chat_sessions.title`.

## 4. Будущий пайплайн (высокоуровневое описание)
```text
1. Пользователь открывает новый чат → отправляет первое сообщение.
2. Бэкенд:
   a. `createChatSession` → возвращаем chatId.
   b. `addUserMessage` пишет первую запись в `chat_messages`.
3. После сохранения сообщения (и до/параллельно LLM-ответа):
   - Проверяем, что у чата пустой `title`.
   - Стартуем асинхронную задачу: `queueGenerateChatTitle(chatId, firstMessageText, workspaceId, userId)`.
4. В фоновой задаче:
   - Берём первые 10–15 слов сообщения (ограничение на length).
   - Формируем промпт системному навыку Unica Chat: «Сформулируй короткое название (≤5 слов) для чата…».
   - Отправляем запрос в LLM (через `buildChatLlmContext`, `executeLlmCompletion`).
   - Результат очищаем, обрезаем по лимиту.
   - Делаем `updateChatSession(chatId, { title: generatedTitle })`, но **только если** `title` всё ещё пустой.
5. UI автоматически подхватит новое имя (список чатов обновляется через `invalidateQueries(["chats"])`).
```
Интерфейс для задачи:
```ts
type GenerateChatTitlePayload = {
  chatId: string;
  workspaceId: string;
  userId: string;
  skillId: string;
  firstMessage: string;
};

function queueChatTitleGeneration(payload: GenerateChatTitlePayload): Promise<void>;
```
Фактическую реализацию (очередь, LLM-вызов) делаем в следующей задаче.

## 5. Тесты/фиксация
- Юнит-тесты на `chat-service` уже покрывают CRUD. Для автогенерации понадобятся дополнительные проверки:
  - `createChat` возвращает пустой `title` → будущий автоген может его заполнить.
  - `renameChat` должен блокировать повторную генерацию (будем проверять условие «если title пустой»).
- Документация:
  - Этот файл описывает, что считается «первым сообщением».
  - Requirements к названию (≤5 слов, только если пусто) задокументированы здесь, чтобы все участники команды ориентировались на одинаковое поведение.

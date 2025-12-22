Вот как сейчас устроен чат (по коду проекта) и ответы на твои вопросы.

1) Жизненный цикл чата

Чат — это запись в chat_sessions (статус active/archived) и связанные сообщения в chat_messages. Схема: schema.ts.
Старт: создаётся через POST /api/chat/sessions (сервер: routes.ts). Если skillId не передан — автоматически берётся/создаётся системный навык Unica Chat.
На фронте чат создаётся либо явно (“новый чат”), либо при первой отправке, если чат ещё не создан (ChatPage.tsx, handleSend → createChat).
Сообщения пишутся в chat_messages при каждом запросе LLM/RAG (chat-service.ts, addUserMessage/addAssistantMessage).
Завершения как состояния “completed” нет. Чат остаётся доступным, пока активен.
“Конец” — это либо:
soft delete (DELETE /api/chat/sessions/:chatId → deletedAt, chat-service.ts, storage.ts);
архивирование (status = archived), например при архивировании навыка — все его чаты переводятся в архив (skills.ts), и тогда чат становится read-only (сервер блокирует отправку).
Любая попытка писать в архивный чат/навык возвращает 403 (routes.ts).
2) Есть ли понятие сессии?

Да. В коде официальное имя сущности — ChatSession (таблица chat_sessions, эндпоинты /api/chat/sessions). В UI это то же самое, что “чат”. Отдельной “сессии” поверх чата нет.
3) Отправка сообщений в RAG/LLM, история и контекст

Фронт всегда шлёт в POST /api/chat/sessions/:chatId/messages/llm через sendChatMessageLLM (useChats.ts).
Сервер сначала сохраняет пользовательское сообщение, потом строит контекст и отвечает (routes.ts).
Если навык RAG (isRagSkill): вызывается callRagForSkillChat. В payload идёт только текущее сообщение пользователя (q), без истории чата (chat-rag.ts). История не отправляется.
Если навык LLM (не RAG): buildChatLlmContext читает всю историю чата (storage.listChatMessages) и buildChatCompletionRequestBody формирует LLM-запрос из system prompt + всех сообщений по порядку (chat-service.ts).
Лимита на длину контекста в коде нет — история не обрезается. Ограничения — только у провайдера/модели. В коде управляется лишь maxTokens (это лимит на ответ, не на вход) и расчёт длины промпта в символах для биллинга (routes.ts).
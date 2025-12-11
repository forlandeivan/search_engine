# Текущий механизм выбора рабочего пространства (2025‑12‑11)

## Источник текущего workspace
- **Бэкенд:** правда хранится в сессии `req.session.workspaceId`. Для входящего запроса `ensureWorkspaceContext` (server/auth.ts) выбирает активный workspace:
  - читает все memberships пользователя через `storage.getOrCreateUserWorkspaces(user.id)`;
  - берёт `X-Workspace-Id` из заголовка, если передан, иначе `req.session.workspaceId`;
  - если найден в memberships — становится активным; иначе берётся первый из списка;
  - записывает `req.workspaceId`, `req.workspaceRole`, `req.workspaceMemberships` и обновляет `req.session.workspaceId`.
- **Фронтенд:** запрашивает `/api/auth/session` (client/src/App.tsx) и получает `{ workspace: { active, memberships } }`. Активное значение хранится в состоянии React Query и используется как дефолт, если в маршруте нет конкретного `workspaceId`.

## Бэкенд: переключение и использование
- **Endpoint переключения:** `POST /api/workspaces/switch` (server/routes.ts, schema `switchWorkspaceSchema`).
  - Принимает `{ workspaceId }`.
  - Проверяет наличие в `req.workspaceMemberships`; если нет — 404.
  - Сохраняет выбранный id в `req.session.workspaceId`, `req.workspaceId`, `req.workspaceRole`, возвращает обновлённый session payload (`buildSessionResponse`).
- **Подстановка в запросы:**
  - `ensureWorkspaceContext(req, user)` вызывается в auth middleware перед защищёнными маршрутами; если контекст не установлен, бросает WorkspaceContextError.
  - В обработчиках workspace-специфичных API используется `getRequestWorkspace(req)` → требует, чтобы `req.workspaceId/role` были выставлены.
  - Для некоторых операций workspaceId передаётся явно в URL/теле (например, `/api/workspaces/:workspaceId/icon`, создание чатов с опциональным `workspaceId`), но общее “текущее” берётся из req.workspaceId, заполненного через сессию/заголовок.

## Фронтенд: маршруты и состояние
- **Маршруты с явным workspaceId:** `/workspaces/:workspaceId/chat`, `/workspaces/:workspaceId/settings`, `/workspaces/:workspaceId/actions`, редирект со старого `/workspaces/:workspaceId/members` на settings?tab=members (client/src/App.tsx).
- **Состояние выбора:** активное workspace приходит в `/api/auth/session`; используется в компонентах (напр., ссылка в сайдбаре `workspace.active?.id`). Переключатель воркспейсов в UI вызывает `POST /api/workspaces/switch`, после чего кэш сессии обновляется.
- **API-вызовы:**
  - Для маршрутов с `:workspaceId` параметр явно прокидывается в хуки (ChatPage, WorkspaceSettingsPage и др.).
  - Для общих вызовов без параметра фронт полагается на сессионный workspace, установленный через switch/ensureWorkspaceContext (например, создание чатов с `workspaceId` опционально).
- **Хранение/обновление:** фронт не хранит workspaceId в localStorage — опирается на ответ /api/auth/session и актуальный URL.

## Ключевые файлы
- **Бэкенд:** `server/auth.ts` (ensureWorkspaceContext, getRequestWorkspace), `server/routes.ts` (switch endpoint, проверки membership/roles).
- **Фронтенд:** `client/src/App.tsx` (загрузка сессии, маршруты), `client/src/types/session.ts` (WorkspaceState), страницы с `:workspaceId` (ChatPage, WorkspaceSettingsPage и др.). 

## Текущее устройство сессий и контекста на бэкенде
- **Сессии:** `express-session` + `connect-pg-simple`, в `SessionData` сохраняются `workspaceId` и `oauthRedirectTo`. Любая смена workspace (`/api/workspaces/switch`) кладёт id в сессию.
- **Аутентификация:** `requireAuth/requireAdmin` вызывают `ensureWorkspaceContext`, который подставляет `req.workspaceId/req.workspaceRole/req.workspaceMemberships`. Либо токен в сессии, либо Bearer-персональный токен.
- **Выбор workspace:** заголовок `X-Workspace-Id` имеет приоритет над сессией; fallback — первый membership (с приоритетом workspace с базами знаний). `resolveWorkspaceIdForRequest` (server/routes.ts) пробрасывает явный id из body/query, но отклоняет, если пользователя нет в `req.workspaceMemberships`.
- **Публичные/встраиваемые запросы:** `resolvePublicCollectionRequest` умеет определять workspace по API-key/`workspaceId`/`kbId`; если API-key нет, пытается аутентифицировать пользователя и вызвать `ensureWorkspaceContext`.

## Авторизация и роли
- **Роли в workspace:** `owner`, `manager`, `user` (из @shared/schema). Локальный helper `isWorkspaceAdmin(role)` в routes считает owner/manager администраторами.
- **Проверки:** единого middleware на права нет; проверки размазаны по хендлерам:
  - для явных workspaceId используется `resolveWorkspaceIdForRequest` (403, если нет membership);
  - для сущностей с `workspaceId` в БД часто вызывают `storage.isWorkspaceMember` / `storage.getWorkspaceMember` для валидации доступа (чаты, транскрипты, документы);
  - операции на иконке и embed-key проверяют админскую роль (owner/manager).
- **Кеш membership:** нет постоянного кеша; `ensureWorkspaceContext` каждый запрос читает memberships и кладёт их в `req.workspaceMemberships`. Вне `requireAuth` публичные маршруты дополнительно дергают `storage.isWorkspaceMember`.

## Мутирующие эндпоинты и явный workspaceId
- **С явным `workspaceId` в URL:** 
  - `/api/workspaces/:workspaceId/icon` (GET/POST/DELETE) — иконка, проверка owner/manager.
  - `/api/workspaces/:workspaceId/actions` и `/:actionId` — CRUD кастомных действий.
  - `/api/workspaces/:workspaceId/transcripts/:transcriptId` (GET для owner/manager, PATCH для stat/metadata) — требуют совпадения workspaceId.
- **Без явного workspaceId, но работают в активном workspace (`getRequestWorkspace` или `resolveWorkspaceIdForRequest`):**
  - `/api/workspaces` (контекст), `/api/workspaces/switch`, `/api/workspaces/members*` — используют текущий workspace из сессии/заголовка, отдельной проверки роли нет.
  - Skills: `/api/skills` CRUD по текущему workspace.
  - Чаты: `/api/chat/sessions*`, `/api/chat/sessions/:chatId/messages*`, completions/stream — workspace берётся из query/body или из текущего.
  - Embed keys & домены: `/api/embed/keys*` — текущий workspace, проверка принадлежности базы знаний.
  - Knowledge Base: `/api/knowledge/bases*`, `/api/kb/:baseId/*`, Ask-AI, vectorization jobs — все завязаны на `getRequestWorkspace`, но `baseId` только в path.
  - Канвасы/транскрипты, списки документов чатов, auto-actions по transcripts — workspace проверяется по сущности в storage.
- **Глобальные/неworkspace:** auth/login/logout/oauth, `/api/auth/providers`, админские `/api/admin/*` (OAuth провайдеры, TTS/STT, SMTP, IAM-токены), реестр embedding/LLM провайдеров (`/api/embedding/services*`, `/api/llm/providers*`), сервисные debug/health роуты.

## Паттерны middleware и ошибок
- **Расширение Request:** в `express-serve-static-core` добавлены `workspaceId`, `workspaceRole`, `workspaceMemberships`.
- **Ошибки:** Zod → 400 с details; `WorkspaceContextError` → 400/404/401; `HttpError` (локально в routes) используется для ручных 4xx; доменные ошибки (например, `KnowledgeBaseError`, `SkillServiceError`) возвращают свой status; общее отсутствие доступа чаще всего `403 { message: "Нет доступа к этому workspace" }`.
- **Промежуточные функции:** `ensureWorkspaceContext` ставит текущий workspace и membership; `getAuthorizedUser` делает 401, если нет сессии; публичные обработчики сами вызывают `ensureWorkspaceContext`, если нет API-key.

## Что дальше переводить на обязательный workspaceId и централизованный middleware
- Чаты/skills/knowledge-base/embed-keys/мембершипы пока полагаются на `req.workspaceId` из сессии; нужно вводить обязательный `workspaceId` в запросах и единое middleware, чтобы не расползалась логика доступа.
- Отдельно обратить внимание на публичные маршруты embed/RAG: сейчас они принимают `workspaceId`/`kbId` опционально и проверяют membership точечно.

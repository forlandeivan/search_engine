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

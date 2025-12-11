# Аудит текущей модели membership и проверок доступа к workspace

## Таблица и роли
- Таблица: `workspace_members` (shared/schema.ts).
- Поля: `workspace_id`, `user_id` (PK по паре), `role` (`owner` | `manager` | `user`, default `user`), `created_at`, `updated_at`. Статусов/soft-delete нет.
- В коде роль «админ» интерпретируется как `owner` или `manager` (`isWorkspaceAdmin` в server/routes.ts).

## Storage-слой
- `storage.getWorkspaceMember(userId, workspaceId)` — прямое чтение строки membership, без кэша.
- `storage.listUserWorkspaces(userId)` — список воркспейсов пользователя с ролью и данными владельца; используется для построения контекста.
- `storage.getOrCreateUserWorkspaces(userId)` — обёртка, создаёт персональный workspace при отсутствии, после чего повторяет `listUserWorkspaces`.
- Кэшей membership нет; каждый вызов идёт в БД.

## Базовые механизмы контекста
- `requireAuth` (auth.ts) → `ensureWorkspaceContext`: берёт user из сессии/токена, тянет все memberships через `getOrCreateUserWorkspaces`, выбирает активный workspace из `X-Workspace-Id` или `session.activeWorkspaceId`/`session.workspaceId`, иначе первый (с приоритетом на имеющий данные). Ставит `req.workspaceId`, `req.workspaceRole`, `req.workspaceMemberships`. Ошибка: `WorkspaceContextError` (404 по умолчанию, сообщение «Рабочее пространство не найдено»).
- `ensureWorkspaceContextMiddleware({ requireExplicitWorkspaceId, allowSessionFallback })` (auth.ts): достаёт `workspaceId` из params/body (или сессии при `allowSessionFallback`), проверяет существование воркспейса (`storage.getWorkspace`) и membership (`storage.getWorkspaceMember`). Ошибки: 400 `"workspaceId is required"` или `"Cannot resolve workspace context"`, 404 `"Workspace '<id>' does not exist"`, 403 `"You do not have access to this workspace"`. Успех → `req.workspaceContext` и бэкап в `req.workspaceId/req.workspaceRole`.
- `resolveWorkspaceIdForRequest` (routes.ts): валидирует candidate `workspaceId` против `req.workspaceMemberships`; при несоответствии бросает `HttpError(403, "Нет доступа к рабочему пространству")`.

## Локальные проверки в хендлерах
- /api/workspaces/:workspaceId/icon (POST/DELETE/GET): явная проверка `storage.getWorkspaceMember`, требуется `owner|manager`; 404 `"workspace not found"`, 403 `"forbidden"`.
- /api/workspaces/switch: проверяет membership через `storage.getWorkspaceMember`; 404 `"Workspace '<id>' does not exist"`, 403 `"You do not have access to this workspace"`.
- Транскрипты (routes.ts ~10170, ~10219): ручная проверка `storage.getWorkspaceMember` перед чтением текста/обновлением; 403 `"Нет доступа к рабочему пространству"` / `"Нет доступа к этому workspace"`.
- Остальные workspace-эндпоинты в routes.ts опираются на `requireAuth` (даёт активный workspace и список membership) + `resolveWorkspaceIdForRequest`/`ensureWorkspaceContextMiddleware` там, где `workspaceId` приходит извне.

## Взаимосвязь с workspace
- Существование workspace проверяется либо в `ensureWorkspaceContextMiddleware`, либо вручную в иконках/переключателе (404), либо опосредованно через `listUserWorkspaces` (requireAuth возвращает только существующие).
- Часть хендлеров берёт `workspaceId` из активного контекста (`getRequestWorkspace`) и не делает отдельной проверки membership — полагаются на `requireAuth`.

## Итоговые заметки
- Роли: `owner`, `manager`, `user`; «админ» = owner|manager.
- Статусы отсутствуют; удаление участника реализуется через удаление строки.
- Проверки membership реализованы в двух местах: общие (`requireAuth`/`ensureWorkspaceContextMiddleware`) и локальные (иконки, переключатель, транскрипты), что приводит к дублированию логики ошибок/ролей.
- Явного кэша membership нет; все запросы ходят в БД.

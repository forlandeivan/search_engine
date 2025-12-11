# Workspace roles & membership (current state, 2025-12-11)

> Аналитический отчёт по данным схемы/кода. Код не менялся.

## Схема данных

- **users** (shared/schema.ts)
  - `id` (uuid), `email` (unique, 255), `full_name`, `password_hash`, `role` (`admin` | `user`), `status` (default `active`), `is_email_confirmed`, `email_confirmed_at`, audit поля.
- **workspaces** (shared/schema.ts)
  - `id` (uuid), `name`, `owner_id` (FK -> users, cascade), `plan` (`free`/`team`), `settings` (jsonb), `icon_url`, `icon_key`, `storage_bucket`, audit поля.
- **workspace_members** (shared/schema.ts)
  - PK составной (`workspace_id`, `user_id`), `role` (`owner` | `manager` | `user`), audit поля.
  - FK workspace_id -> workspaces (cascade), user_id -> users (cascade).
- Дополнительно: многие сущности (skills, chats, knowledge bases и т.д.) имеют FK `workspace_id`, но для ролей/участия ключевые таблицы выше.

Владелец воркспейса хранится и в `workspaces.owner_id`, и дублируется как membership с `role="owner"` (создаётся/синхронизируется в ensurePersonalWorkspace).

## Роли

- **Глобальные роли пользователя** (`userRoles` в shared/schema.ts): `admin`, `user`.
  - `admin` используется для /api/admin/* (guards в server/routes.ts, server/auth.ts).
  - `user` — обычный пользователь.
- **Роли участника воркспейса** (`workspaceMemberRoles` в shared/schema.ts): `owner`, `manager`, `user`.
  - В коде server/routes.ts есть утилита `isWorkspaceAdmin(role)` → `owner` или `manager`.
  - Ограничения: нельзя понизить/удалить единственного `owner` (проверки в routes.ts рядом с /api/workspaces/members).

## Membership (user ↔ workspace)

- Связь хранится в `workspace_members` без статусов (только роль + audit).
- Пользователь может состоять в нескольких воркспейсах (listUserWorkspaces в server/storage.ts).
- Создание:
  - При создании/логине через email/Google/Yandex вызывается `ensurePersonalWorkspace` (server/storage.ts) → создаёт личный workspace, ставит `owner_id=user.id`, добавляет membership `owner`, создаёт системный skill.
  - При инвайте: POST `/api/workspaces/:workspaceId/members` (routes.ts) → добавляет запись в `workspace_members` с выбранной ролью, если пользователь найден по email.
- Обновление роли: PATCH `/api/workspaces/members/:memberId` (routes.ts) → меняет `role`, запрещено убирать последнего owner.
- Удаление участника: DELETE `/api/workspaces/members/:memberId` (routes.ts) → запрещено удалять единственного owner.
- Проверка членства: `isWorkspaceMember(workspaceId, userId)` в server/storage.ts (используется через ensureWorkspaceContext).
- В контексте сессии: `ensureWorkspaceContext` (server/auth.ts) грузит все memberships пользователя, по первому подбирает активный workspace; если нет — создаётся личный.

## Права управления воркспейсом (фактические проверки)

- **Админские действия внутри workspace** (routes.ts):
  - Функция `isWorkspaceAdmin(role)` (owner или manager) используется для:
    - загрузки/сброса иконки воркспейса `/api/workspaces/:workspaceId/icon` (POST/DELETE/GET proxy) — требуется membership с ролью owner/manager;
    - управление участниками (invite/update/delete) — owner/manager; доп. правило: не трогаем последнего owner;
    - большинство workspace-специфичных настроек/ресурсов также требуют выбранный workspace и валидного участника (через `getRequestWorkspace`, `getAuthorizedUser`), но отдельные действия явно проверяют `isWorkspaceAdmin`.
- **Глобальные админские права**:
  - /api/admin/** (SMTP, LLM, журнал системных уведомлений и т.д.) проверяют `user.role === "admin"` в server/auth.ts / routes.ts.
- **Владелец тарифа**:
  - Отдельного понятия “billing owner” нет. Текущее поле `owner_id` + membership `owner` — единственный источник “владельца”.
  - Логика тарифа (workspace_plan) существует в схеме (`plan` колонка), но специальных прав управления тарифом не выделено.

## Ключевые места в коде

- Схема: `shared/schema.ts` — userRoles, workspaceMemberRoles, таблицы users/workspaces/workspace_members.
- Контекст/авторизация: `server/auth.ts` — ensureWorkspaceContext (подбирает/создаёт workspace), guards для admin.
- Работа с membership и workspace: `server/storage.ts` — listUserWorkspaces, ensurePersonalWorkspace, add/update/remove/listWorkspaceMember(s), isWorkspaceMember.
- Роуты управления участниками и иконкой: `server/routes.ts` — блок около `isWorkspaceAdmin`, /api/workspaces/*/members, /api/workspaces/:workspaceId/icon.

## Итоги

- Роли: глобальные (`admin`/`user`) + внутри workspace (`owner`/`manager`/`user`).
- Владелец воркспейса хранится в `workspaces.owner_id` и как membership `owner`; единственный owner защищён от удаления/понижения.
- Membership без статусов, один пользователь может быть в нескольких workspace.
- Админские действия внутри workspace доступны owner/manager; глобальные настройки — только user.role=admin.
- Отдельной модели “плательщика”/“владельца тарифа” нет — сейчас это совпадает с owner. 

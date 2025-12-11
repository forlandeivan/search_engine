# Аудит авторизаций и изолированности по воркспейсу (2025‑12‑11)

> Аналитика по коду/схеме, без изменений. Основные файлы: `server/routes.ts`, `server/auth.ts`, `server/storage.ts`, `shared/schema.ts`.

## Сущности, завязанные на workspace

- **workspaces** — корневая сущность, `workspaces.id`, поле `owner_id`.
- **workspace_members** — membership, PK (workspace_id,user_id), `role` (`owner`/`manager`/`user`).
- **skills** — `workspace_id`, индекс `skills_workspace_idx`.
- **skill_actions** — `workspace_id`.
- **skill_knowledge_bases** / **knowledge_bases** / **knowledge_nodes** / **knowledge_documents** / **knowledge_document_chunk_*` — везде FK `workspace_id`.
- **actions** — `workspace_id` (scope workspace).
- **chat_sessions** — `workspace_id`, индекс `chat_sessions_workspace_user_idx`.
- **chat_messages** — `workspace_id`.
- **transcripts**, **transcript_views**, **canvas_documents** — `workspace_id`.
- **asr_executions**, **skill_executions**, **llm_executions** — имеют `workspace_id` и индексы.
- **workspace_vector_collections**, **workspace_embed_keys/domains**, **workspace_storage_bucket/icon** (MinIO), **system_notification_logs** (workspace_id optional? — проверить при дальнейшем биллинге).
- Любые файлы/иконки — через bucket per workspace (storage_bucket, icon_key).

## Эндпоинты и проверки (ключевые)

Формат: `METHOD URL` — сущности — фильтр по workspace? — проверка membership? — проверка роли?

- **POST /api/workspaces/switch** — сессия/контекст — membership берётся из `req.workspaceMemberships` (ensureWorkspaceContext) — роли не проверяются, только наличие.
- **GET /api/workspaces/members** — `workspace_members` — workspace из контекста — требуется авторизация; роли не проверяются (но доступ только членам текущего workspace через ensureWorkspaceContext).
- **POST /api/workspaces/members** — добавление участника — workspace из контекста — членство текущего пользователя обязательно; роль: `isWorkspaceAdmin` (owner|manager); запрет добавлять дубликат.
- **PATCH /api/workspaces/members/:memberId** — смена роли — workspace из контекста — `isWorkspaceAdmin`; запрет понизить единственного owner.
- **DELETE /api/workspaces/members/:memberId** — удаление — workspace из контекста — `isWorkspaceAdmin`; запрет удалить единственного owner.

- **POST /api/workspaces/:workspaceId/icon** / **DELETE /api/workspaces/:workspaceId/icon** / **GET /api/workspaces/:workspaceId/icon** — иконка (MinIO) — workspaceId из params; membership загружается через ensureWorkspaceContext + явная проверка `isWorkspaceAdmin`; фильтр по workspace на уровне хранения — bucket per workspace.

- **Skills** (`/api/skills`, `/api/skills/:id`, actions и т.п.) — сущности skills/skill_actions/skill_knowledge_bases. Workspace берётся из контекста (`getRequestWorkspace`) или из тела при создании. Фильтр по workspace в storage-слое (workspaceId в where). Membership — через ensureWorkspaceContext; роли: не всегда требуются, обычный user имеет доступ к своим workspace-скиллам (отдельных проверок на owner/manager нет).

- **Knowledge base** (`/api/knowledge-bases/*`) — все запросы используют `getRequestWorkspace(req)` → гарантия, что workspaceId из контекста; membership проверяется в ensureWorkspaceContext. Ролевых ограничений (owner/manager) нет — любой участник workspace работает с базой.

- **Chat** (`/api/chat/sessions`, `/api/chat/messages`) — workspaceId в теле опционален; если не передан, берётся из сессии (getRequestWorkspace). В хранилище фильтр по workspaceId. Membership — через ensureWorkspaceContext. Роли — нет.

- **Transcripts/Canvas** (`/api/transcripts/*`, `/api/canvas-documents/*`) — workspaceId связан через transcript/chat; фильтрация по workspaceId в запросах; membership через контекст, ролей нет.

- **Executions** (ASR/Skill/LLM) — фильтр по workspaceId в storage и в /admin логах (admin зона глобальная). Доступ к админским спискам — только user.role=admin (глобальный).

- **Workspace settings** (план/название/иконка) — `/api/workspaces/:workspaceId` (получение) и icon endpoints: требуют membership; для иконки — owner|manager. План/биллинг специальных проверок пока нет, обновление имени/описания ограничено — фактические права в routes.ts: в основном доступно членам.

- **Admin endpoints** (`/api/admin/*` — SMTP, LLM providers, system notification logs, TTS/STT) — глобальная роль admin, workspace не используется или опционален (фильтры по workspaceId в админ-логах по параметру).

## Проблемные/потенциально слабые места

- Ролевые проверки внутри workspace часто отсутствуют (skills, knowledge bases, чаты) — любой участник workspace может читать/создавать/удалять сущности. Для биллинга/лимитов может потребоваться ужесточение (owner/manager).
- Чат/сообщения: при создании сообщения workspaceId опционален, контекст берётся из сессии — важно, чтобы ensureWorkspaceContext всегда был вызван. Проверок на роль нет.
- Knowledge base / skills: нет явного разграничения прав (кроме того, что пользователь — член workspace). Если тарифы должны ограничивать создание/удаление — нужно добавить.
- Workspace settings (кроме иконки/участников): имя/описание сегодня почти read-only, но когда появится редактирование — нужно решить, кто может (owner/manager).
- Админка глобальная: если появятся workspace-специфичные админ-настройки, нужно добавить фильтр по workspaceId + membership, сейчас это зона супер-админа.

## Выводы

- Изолированность по workspace достигается через `ensureWorkspaceContext` + фильтры workspaceId в storage-запросах для большинства сущностей.
- Полноценные ролевые проверки есть только в управлении участниками и иконкой (owner/manager). Остальные сущности опираются лишь на факт членства.
- Для будущего биллинга следует:
  - ревизовать права на создание/удаление/массовые операции в workspace;
  - потребовать явный workspaceId во всех изменяющих запросах (минимизировать “по умолчанию из сессии”);
  - добавить проверки лимитов/плана там, где появляются дорогие операции (LLM/ASR, загрузка файлов, RAG). 

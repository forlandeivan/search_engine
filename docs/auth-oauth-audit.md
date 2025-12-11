# Аудит аутентификации, OAuth и API‑токенов (2025‑12‑11)

> Аналитика по коду, без изменений. Основные файлы: `server/auth.ts`, `server/routes.ts`, `server/storage.ts`, `shared/schema.ts`.

## Локальная аутентификация

- **Регистрация /api/auth/register** — создаёт пользователя (email, password), подтверждение e‑mail через письмо (status `pending`, is_email_confirmed=false), создаётся личный workspace (ensurePersonalWorkspace). Логика в `server/routes.ts` + email подтверждение в `server/auth.ts/registration email`.
- **Логин /api/auth/login** — проверка email+пароль, если is_email_confirmed=false / status=PendingEmailConfirmation → 403 email_not_confirmed, иначе выдача сессии/JWT (session response через `buildSessionResponse`).
- **Подтверждение e‑mail /api/auth/verify-email** — по токену (email_confirmation_tokens), устанавливает is_email_confirmed=true, status=active, помечает токен consumed.
- **Workspace связь:** при успешном создании/обновлении юзера ensurePersonalWorkspace создаёт/подвязывает личный workspace и membership owner.

## OAuth (Google, Yandex)

- Конфигурация и обработчики в `server/auth.ts` + `server/storage.ts` (`upsertUserFromGoogle`, `upsertUserFromYandex`).
- **Правила поиска/создания User:**
  - Нормализуются external id (`googleId` / `yandexId`) и email (toLower).
  - Если найден по external id → обновление профиля + ensurePersonalWorkspace.
  - Иначе ищется по email:
    - если есть пользователь с таким email → привязывается external id к существующему User, обновляются поля профиля, ensurePersonalWorkspace.
    - если нет — создаётся новый User с email, именем из профиля, external id, флагами emailVerified от провайдера, затем ensurePersonalWorkspace.
- **Склейка аккаунтов:** присутствует — при совпадении email OAuth-логин привязывается к существующей записи (не создаёт дубликат). Также если сначала вход по внешнему id, затем по email (того же провайдера), id привязывается к той же записи.

## Персональные API‑токены

- Схема в `shared/schema.ts`: поля `personal_api_token_hash`, `personal_api_token_last_used_at` в таблице users.
- Генерация/валидация в `server/auth.ts` / `server/routes.ts` (личные токены в session payload).
- Привязка: токен к User (не к workspace). Скоупов/ролей нет, срок действия не задан; ревокация — обновлением хеша (не хранится plaintext).
- Проверка membership: API‑токен аутентифицирует пользователя, далее срабатывают обычные проверки workspace через ensureWorkspaceContext.

## Риски для биллинга / мультиаккаунтов

- **Дубликаты аккаунтов:** смягчены за счёт склейки по email в OAuth (если email совпал). Но разные внешние провайдеры с разными email → создадут разные User.
- **Неподтверждённый email:** локальная регистрация блокирует логин до подтверждения; OAuth полагается на emailVerified от провайдера, но записи могут появиться без подтверждения в локальной почте.
- **API‑токены:** дают доступ ко всем воркспейсам пользователя; дополнительных ограничений/скоупов нет (важно для биллинга/лимитов — может потребоваться план‑aware токены).
- **Workspace привязка:** ensurePersonalWorkspace создаёт личный workspace, что может вести к множеству бесплатных воркспейсов на одного человека при разных аккаунтах (если email различается между провайдерами).

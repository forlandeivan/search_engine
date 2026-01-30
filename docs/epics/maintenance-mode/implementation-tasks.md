# Задачи‑промпты для реализации режима обслуживания (MVP)

Ниже — последовательные «промпты», которые можно брать в работу по очереди. Включены решения всех выявленных проблем.
После завершения работ по промту и когда пользователь скажет, что он принял работу, нужно пометить рядом с названием, что "ПРОМТ ГОТОВ"
для проверки готовности, если нужно используй playwright, логин от учетки админа: "forlandeivan@gmail.com" пароль: "q1w2e3r4";
---

## PROMPT MM‑00 — Защита /api/admin (блокер безопасности) — ПРОМТ ГОТОВ
**Цель:** гарантировать доступ к админке только для `admin`.

**Почему важно:** без этого режима обслуживания может быть изменён не‑админом.

**Что сделать:**
- Применить `requireAdmin` на уровне монтирования `adminRouter` (например, `app.use('/api/admin', requireAdmin, adminRouter)`), либо добавить middleware в `server/routes/admin/index.ts`.
- Проверить, что `/api/admin/*` возвращает 403 для не‑админа.

**Критерии готовности:**
- Любой вызов `/api/admin/*` без роли `admin` → 403.

---

## PROMPT MM‑01 — Схема БД и типы — ПРОМТ ГОТОВ
**Цель:** добавить хранение настроек режима обслуживания и аудит‑журнал.

**Что сделать:**
- Добавить таблицы `maintenance_mode_settings` и `maintenance_mode_audit_log` в `shared/schema.ts`.
- Создать миграцию в `migrations/` (SQL), по аналогии с `0055_smtp_settings.sql` и `0058_system_notification_logs.sql`.

**Критерии готовности:**
- Таблицы содержат `scheduled_start_at`, `scheduled_end_at`, `force_enabled`, `message_title`, `message_body`, `public_eta`, `updated_by_admin_id`, `created_at`, `updated_at`.
- Аудит‑лог содержит `event_type`, `actor_admin_id`, `occurred_at`, `payload` (jsonb).

---

## PROMPT MM‑02 — Shared DTO и валидация — ПРОМТ ГОТОВ
**Цель:** единый контракт данных между сервером и клиентом.

**Что сделать:**
- Создать `shared/maintenance-mode.ts` с Zod‑схемами и типами:
  - `MaintenanceModeSettingsDto`
  - `UpdateMaintenanceModeSettingsDto`
  - `MaintenanceModeStatusDto`

**Критерии готовности:**
- Валидация дат, обязательности полей и длины сообщений.

---

## PROMPT MM‑03 — Сервис настроек + кэш — ПРОМТ ГОТОВ
**Цель:** логика чтения/обновления и вычисления статуса.

**Что сделать:**
- Создать `server/maintenance-mode-settings.ts` (по образцу `smtp-settings.ts`).
- Добавить кэш‑ключ в `server/cache/cache-manager.ts`.
- Реализовать `getSettings()`, `updateSettings()`, `getEffectiveStatus()`.

**Критерии готовности:**
- Singleton‑хранение настроек.
- Корректный расчёт `off/scheduled/active`.
- Кэш инвалидируется при обновлении.

---

## PROMPT MM‑04 — Админские API — ПРОМТ ГОТОВ
**Цель:** дать администратору UI/API для управления.

**Что сделать:**
- В `server/routes/admin/settings.routes.ts` добавить:
  - `GET /api/admin/settings/maintenance`
  - `PUT /api/admin/settings/maintenance`

**Критерии готовности:**
- Возвращается корректный DTO.
- Доступ только для `admin` (опирается на MM‑00).

---

## PROMPT MM‑05 — Публичный API статуса + allowlist (блокер UX) — ПРОМТ ГОТОВ
**Цель:** статус доступен без авторизации даже при активном режиме.

**Что сделать:**
- Добавить `GET /api/maintenance/status` (отдельный router или `public.routes.ts`).
- Добавить `/api/maintenance/` в allowlist `publicPaths` в `server/routes.ts` (иначе будет 401).
- В `maintenanceModeGuard` добавить allowlist для `/api/maintenance/status` (иначе будет 503).

**Критерии готовности:**
- Endpoint доступен без авторизации и во время активного режима.
- Ответ содержит `status`, `messageTitle`, `messageBody`, `publicEta`, `serverTime`.

---

## PROMPT MM‑06 — Middleware блокировки запросов — ПРОМТ ГОТОВ
**Цель:** единая серверная блокировка во время обслуживания.

**Что сделать:**
- Создать `server/middleware/maintenance-mode.ts`.
- Подключить middleware в `registerRoutes()` **до** `registerRouteModules()`.
- Реализовать allowlist: `/api/maintenance/status`, `/api/health/*`, `/api/metrics`, `/metrics`, `/api/admin/*`.
- Блокировать `/api/auth/*` в активном режиме.

**Критерии готовности:**
- Все остальные `/api/*` возвращают 503 + `errorCode=MAINTENANCE_MODE`.

---

## PROMPT MM‑07 — Админ‑страница UI — ПРОМТ ГОТОВ
**Цель:** интерфейс управления режимом.

**Что сделать:**
- Создать `client/src/pages/AdminMaintenanceModePage.tsx` в стиле `SmtpSettingsPage`.
- Добавить пункт в `AdminSidebar`.
- Зарегистрировать маршрут в `client/src/App.tsx`.

**Критерии готовности:**
- Все поля доступны и сохраняются.
- Есть блок «Журнал» с последними событиями аудита.

---

## PROMPT MM‑08 — Баннер и экран обслуживания (включая AuthPage)
**Цель:** корректный UX без «ломаного» экрана входа.

**Что сделать:**
- Создать `useMaintenanceStatus` (React Query, refetchInterval ≤ 60s).
- Добавить `MaintenanceBanner` и `MaintenanceOverlay`.
- Подключить в `client/src/App.tsx` (обёртка над роутером).
- В `AuthPage` скрывать форму и показывать overlay при active.
- При ошибке `/api/auth/session` + `errorCode=MAINTENANCE_MODE` показывать overlay, а не fallback на обычный `AuthPage`.

**Критерии готовности:**
- Баннер появляется до начала.
- При active показывается overlay, вход недоступен.

---

## PROMPT MM‑09 — Единая обработка ошибки MAINTENANCE_MODE
**Цель:** понятные сообщения при блокировке.

**Что сделать:**
- В `apiRequest` или в местах обработки ошибок проверять `errorCode`.
- Показывать единый toast.

**Критерии готовности:**
- При 503 пользователь видит корректное сообщение.

---

## PROMPT MM‑10 — Тесты
**Цель:** закрепить поведение.

**Что сделать:**
- Юнит‑тесты для `getEffectiveStatus()`.
- Интеграционные тесты middleware (allowlist + блокировка auth).
- UI‑тесты баннера и экрана обслуживания.

**Критерии готовности:**
- Основные сценарии из `test-scenarios.md` автоматизированы.

---

## PROMPT MM‑11 — Документация и runbook
**Цель:** согласовать эксплуатацию.

**Что сделать:**
- Добавить в docs краткий runbook «как выключить режим вручную, если админ не залогинен».
- Обновить публичную документацию (если требуется).

**Критерии готовности:**
- Документация описывает фактическое поведение и fallback.


## PROMPT MM‑12 — Уборка
- перенести md файлы с описанием из C:\repositories\search_engine\docs\epics\maintenance-mode в папку Releases, которая упоминается в гитигнор.
- Провермить, что не осталось мусорных файлов от эпика

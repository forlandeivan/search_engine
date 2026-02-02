# Требования к серверной логике режима обслуживания (MVP)

## 1) Источник правды и вычисление статуса
- Источник данных — singleton‑таблица настроек (по аналогии с SMTP/индексацией).
- Эффективный статус вычисляется:
  - если `forceEnabled=true` → `active`;
  - иначе, если `now ∈ [scheduledStartAt, scheduledEndAt]` → `active`;
  - иначе, если `scheduledStartAt > now` → `scheduled`;
  - иначе → `off`.

## 2) Публичный endpoint статуса
- **GET /api/maintenance/status** (без авторизации).
- Ответ включает: `status`, `scheduledStartAt`, `scheduledEndAt`, `messageTitle`, `messageBody`, `publicEta`, `serverTime`.
- Endpoint должен быть исключён из `requireAuth` в `server/routes.ts` (publicPaths).

## 3) Админские endpoints
- **GET /api/admin/settings/maintenance** — получить настройки.
- **PUT /api/admin/settings/maintenance** — обновить настройки.
- Доступ только для `admin`.

## 4) Middleware блокировки запросов
- Ввести `maintenanceModeGuard` и подключить **до** `registerRouteModules()` в `registerRoutes()`.
- **Активный режим:** блокировать **все** `/api/*`, кроме allowlist:
  - `/api/maintenance/status`
  - `/api/health/*`
  - `/api/metrics`, `/metrics`
  - `/api/admin/*` (управление режимом при активной сессии администратора)
- `/api/auth/*` в активном режиме **блокируются** (вход запрещён).
- Ответ при блокировке: 503 +
  ```json
  {
    "errorCode": "MAINTENANCE_MODE",
    "message": "Идут технические работы",
    "scheduledEndAt": "..."
  }
  ```

## 5) Кэширование статуса
- Использовать `server/cache` (Redis/memory) для статуса режима.
- TTL кэша: 30–60 секунд.
- Инвалидация кэша при обновлении настроек.

## 6) Логирование
- Логировать админ‑действия в отдельный аудит‑журнал.
- Отдельное логирование каждого заблокированного запроса **не требуется** (MVP).

## 7) Фоновые процессы
- В MVP допускается игнорировать запущенные фоновые процессы.
- Ответственность за запуск перед релизом лежит на пользователях (с явным предупреждением в сообщении).

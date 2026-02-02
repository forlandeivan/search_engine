# Режим обслуживания: публичный статус

## Назначение
Публичная точка позволяет клиентам получать актуальный статус обслуживания без авторизации.

## Endpoint
- `GET /api/maintenance/status`

## Ответ
```json
{
  "status": "off | scheduled | active",
  "scheduledStartAt": "2026-01-01T12:00:00.000Z | null",
  "scheduledEndAt": "2026-01-01T14:00:00.000Z | null",
  "messageTitle": "string",
  "messageBody": "string",
  "publicEta": "string | null",
  "serverTime": "2026-01-01T11:59:30.000Z"
}
```

## Поведение
- `scheduled`: клиент может показать баннер о плановом обслуживании.
- `active`: остальные API‑запросы (кроме allowlist) возвращают 503 с `errorCode=MAINTENANCE_MODE`.

## Ограничения
- Endpoint только для чтения, изменение режима доступно через админ‑настройки.

# Как настроить Postman для отправки информации о транскрибации

## Быстрый старт

Для отправки информации о том, что идёт транскрибация, используйте API `bot_action`.

## Шаг 1: Настройка окружения в Postman

1. Создайте новую коллекцию или используйте существующую
2. Добавьте переменные окружения:
   - `base_url` — базовый URL API (например, `http://localhost:5000` или `https://api.example.com`)
   - `callback_token` — токен для no-code callbacks (Bearer token)
   - `workspace_id` — ID рабочего пространства
   - `chat_id` — ID чата

## Шаг 2: Создание запроса "Start транскрибация"

### Настройки запроса

**Method:** `POST`  
**URL:** `{{base_url}}/api/no-code/callback/actions/start`

### Headers

```
Authorization: Bearer {{callback_token}}
Content-Type: application/json
```

### Body (raw JSON)

```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "displayText": "Готовим стенограмму…"
}
```

**Примечание:** `actionId` использует `{{$timestamp}}` для уникальности. Можно также использовать `{{$randomUUID}}` если доступно.

### Пример с payload

Если нужно передать дополнительные данные:

```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "displayText": "Готовим стенограмму…",
  "payload": {
    "transcriptId": "transcript-123",
    "fileName": "audio.mp3",
    "duration": 120
  }
}
```

## Шаг 3: Создание запроса "Update транскрибация (done)"

### Настройки запроса

**Method:** `POST`  
**URL:** `{{base_url}}/api/no-code/callback/actions/update`

### Headers

```
Authorization: Bearer {{callback_token}}
Content-Type: application/json
```

### Body (raw JSON)

```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "status": "done",
  "displayText": "Стенограмма готова!",
  "payload": {
    "transcriptId": "transcript-456",
    "fullText": "Текст стенограммы..."
  }
}
```

**Важно:** `actionId` должен совпадать с тем, что был в `start`!

## Шаг 4: Создание запроса "Update транскрибация (error)"

### Настройки запроса

**Method:** `POST`  
**URL:** `{{base_url}}/api/no-code/callback/actions/update`

### Headers

```
Authorization: Bearer {{callback_token}}
Content-Type: application/json
```

### Body (raw JSON)

```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "status": "error",
  "displayText": "Ошибка при транскрибации"
}
```

## Шаг 5: Создание запроса "GET активные actions" (для проверки)

### Настройки запроса

**Method:** `GET`  
**URL:** `{{base_url}}/api/chat/actions?workspaceId={{workspace_id}}&chatId={{chat_id}}&status=processing`

### Headers

```
Authorization: Bearer {{user_token}}
```

**Примечание:** Для GET нужен user token (не callback token), так как это обычный endpoint, а не no-code callback.

## Полный сценарий в Postman

### Вариант 1: Ручной запуск

1. Запустите запрос "Start транскрибация"
2. Дождитесь выполнения транскрибации (или симулируйте задержку)
3. Запустите запрос "Update транскрибация (done)" с тем же `actionId`

### Вариант 2: Использование Tests для автоматизации

Добавьте в Tests запроса "Start транскрибация":

```javascript
// Сохраняем actionId для последующего использования
if (pm.response.code === 200) {
    const response = pm.response.json();
    pm.environment.set("last_action_id", response.action.actionId);
    console.log("Action started:", response.action.actionId);
}
```

Затем в запросе "Update транскрибация (done)" используйте:

```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "{{last_action_id}}",
  "actionType": "transcribe_audio",
  "status": "done"
}
```

## Примеры для разных сценариев

### Сценарий 1: Транскрибация с кастомным текстом

**Start:**
```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "displayText": "Обрабатываем аудиозапись..."
}
```

**Update (done):**
```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "status": "done",
  "displayText": "Стенограмма готова!"
}
```

### Сценарий 2: Транскрибация с payload

**Start:**
```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "displayText": "Готовим стенограмму…",
  "payload": {
    "transcriptId": "transcript-{{$timestamp}}",
    "fileName": "meeting-2024-01-01.mp3",
    "duration": 300,
    "language": "ru"
  }
}
```

**Update (done) с результатом:**
```json
{
  "workspaceId": "{{workspace_id}}",
  "chatId": "{{chat_id}}",
  "actionId": "transcribe-{{$timestamp}}",
  "actionType": "transcribe_audio",
  "status": "done",
  "payload": {
    "transcriptId": "transcript-{{$timestamp}}",
    "fullText": "Полный текст стенограммы...",
    "wordCount": 1500
  }
}
```

## Проверка работы

1. **Отправьте Start запрос** — должен вернуть 200 с объектом `action` со статусом `processing`
2. **Проверьте в чате** — должна появиться строка активности "Готовим стенограмму…"
3. **Отправьте Update (done)** — должен вернуть 200 с объектом `action` со статусом `done`
4. **Проверьте в чате** — строка активности должна исчезнуть

## Troubleshooting

### Ошибка 401 Unauthorized

**Причина:** неверный `callback_token` или отсутствует заголовок `Authorization`

**Решение:** проверьте переменную `{{callback_token}}` и формат заголовка `Bearer {{callback_token}}`

### Ошибка 404 "Действие с actionId '...' не найдено"

**Причина:** `update` вызван до `start` или `actionId` не совпадает

**Решение:** сначала вызовите `start`, затем `update` с тем же `actionId`

### Ошибка 400 "Некорректные данные"

**Причина:** неверный формат JSON или отсутствуют обязательные поля

**Решение:** проверьте, что все обязательные поля присутствуют (`workspaceId`, `chatId`, `actionId`, `actionType`)

### Индикатор не появляется в чате

**Проверьте:**
1. `start` вернул 200?
2. `workspaceId` и `chatId` корректны?
3. Фронт подписан на SSE события?
4. После refresh фронт делает GET для восстановления?

## Полезные ссылки

- Полная документация: `docs/bot-action-api-guide.md`
- Контракт: `docs/bot-action-contract.md`


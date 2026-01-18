# PubSub для масштабирования real-time событий

## Обзор

Phase 4.2 рефакторинга добавляет поддержку горизонтального масштабирования для real-time событий через абстракцию PubSub.

### Проблема

До рефакторинга `chat-events.ts` использовал локальный `EventEmitter`, который работает только в рамках одного процесса:

```
[Instance 1] ──────────────────────────────────────────
   │ emitChatMessage('chat:123', {...})
   │     └── EventEmitter.emit('chat:123', ...)
   │           └── SSE connection 1 ✓
   │           └── SSE connection 2 ✓
   
[Instance 2] ──────────────────────────────────────────
   │     └── SSE connection 3 ✗ (не получит событие!)
```

### Решение

Добавлена абстракция PubSub с двумя провайдерами:

1. **LocalPubSub** - для single-instance (development, простые деплои)
2. **RedisPubSub** - для multi-instance (production с load balancer)

```
[Instance 1] ──────────────────────────────────────────
   │ emitChatMessage('chat:123', {...})
   │     └── LocalEmitter + Redis PUBLISH
   │           │
[Redis]       │
   │    ◀─────┘
   │    ─────────────────────────────────────────────▶
   │                                                  │
[Instance 2] ──────────────────────────────────────────
         └── Redis SUBSCRIBE
               └── LocalEmitter.emit('chat:123', ...)
                     └── SSE connection 3 ✓
```

## Архитектура

```
server/realtime/
├── pubsub.ts           # Интерфейс PubSubProvider + LocalPubSub
├── redis-pubsub.ts     # RedisPubSub реализация
└── index.ts            # Выбор провайдера + хелперы
```

### Интерфейс PubSubProvider

```typescript
interface PubSubProvider {
  readonly name: string;
  
  publish<T>(channel: string, data: T): Promise<void>;
  subscribe<T>(pattern: string, handler: PubSubHandler<T>): () => void;
  subscribeExact<T>(channel: string, handler: PubSubHandler<T>): () => void;
  
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}
```

### Автоматический выбор провайдера

```typescript
// server/realtime/index.ts
export function getPubSub(): PubSubProvider {
  if (process.env.REDIS_URL) {
    return new RedisPubSub({ url: process.env.REDIS_URL });
  }
  return new LocalPubSub();
}
```

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `REDIS_URL` | URL Redis сервера (e.g., `redis://localhost:6379`) | Не задана (LocalPubSub) |

### Примеры REDIS_URL

```bash
# Локальный Redis
REDIS_URL=redis://localhost:6379

# Redis с паролем
REDIS_URL=redis://:password@localhost:6379

# Redis Cloud / AWS ElastiCache
REDIS_URL=redis://:password@redis-12345.c1.us-east-1-2.ec2.cloud.redislabs.com:12345
```

## Использование

### Прямое использование PubSub

```typescript
import { pubsub, getChatChannel } from './realtime';

// Публикация события
await pubsub.publish('chat:123', { type: 'message', text: 'Hello' });

// Подписка на канал
const unsubscribe = pubsub.subscribeExact('chat:123', (msg) => {
  console.log('Received:', msg.data);
});

// Подписка на паттерн
const unsubscribeAll = pubsub.subscribe('chat:*', (msg) => {
  console.log('Chat event:', msg.channel, msg.data);
});

// Отписка
unsubscribe();
unsubscribeAll();
```

### Через chat-events (рекомендуется)

```typescript
import { 
  emitChatMessage, 
  emitBotAction, 
  onChatEvent, 
  offChatEvent 
} from './chat-events';

// Подписка на события чата
onChatEvent('chat-id-123', (payload) => {
  if (payload.type === 'message') {
    // Новое сообщение
  } else if (payload.type === 'bot_action') {
    // Действие бота
  }
});

// Публикация сообщения (автоматически через PubSub)
emitChatMessage('chat-id-123', { text: 'Hello', role: 'user' });

// Публикация действия бота
emitBotAction('chat-id-123', { actionType: 'thinking' });

// Отписка
offChatEvent('chat-id-123', handler);
```

## Health Check

### Endpoint

```
GET /api/health/pubsub
```

### Ответ

```json
{
  "status": "ok",
  "provider": "redis",
  "healthy": true,
  "stats": {
    "channels": 5,
    "patterns": 1
  },
  "chatSubscriptions": {
    "localChats": 10,
    "remoteSubscriptions": 10,
    "pubsubProvider": "redis"
  },
  "timestamp": "2026-01-18T12:00:00.000Z"
}
```

## Тестирование

```bash
# Запустить тесты PubSub
npm test -- --run tests/realtime/

# Запустить все тесты
npm test
```

## Миграция существующего кода

### До (ручное использование EventEmitter)

```typescript
import { chatEvents } from './chat-events';

chatEvents.emit(chatId, { type: 'message', message });
chatEvents.on(chatId, handler);
chatEvents.off(chatId, handler);
```

### После (через функции-хелперы)

```typescript
import { 
  emitChatMessage, 
  onChatEvent, 
  offChatEvent 
} from './chat-events';

emitChatMessage(chatId, message);
onChatEvent(chatId, handler);
offChatEvent(chatId, handler);
```

**Важно:** Прямое использование `chatEvents.emit()` всё ещё работает, но события не будут распространяться на другие инстансы. Рекомендуется использовать функции-хелперы.

## Graceful Shutdown

При остановке сервера автоматически:

1. Очищаются все подписки на события чатов
2. Закрываются соединения с Redis
3. Освобождаются ресурсы

```typescript
// server/index.ts
const shutdown = async (signal: string) => {
  // ... other cleanup ...
  
  cleanupChatSubscriptions();
  await closePubSub();
  
  // ... close db, exit ...
};
```

## Мониторинг

### Prometheus метрики

(Будут добавлены в следующих итерациях)

- `pubsub_messages_published_total` - Количество опубликованных сообщений
- `pubsub_messages_received_total` - Количество полученных сообщений
- `pubsub_subscriptions_active` - Количество активных подписок

### Логи

PubSub использует структурированное логирование через Pino:

```json
{"level":"info","time":1705579200000,"msg":"Using RedisPubSub for realtime events","provider":"redis"}
{"level":"debug","time":1705579200001,"msg":"Published message to Redis","channel":"chat:123"}
{"level":"debug","time":1705579200002,"msg":"Forwarded remote chat event","chatId":"123","from":"redis-12345-1705579100000"}
```

## Troubleshooting

### События не доставляются на другие инстансы

1. Проверьте, что `REDIS_URL` задан корректно
2. Проверьте health endpoint: `GET /api/health/pubsub`
3. Проверьте, что используется `emitChatMessage()`, а не `chatEvents.emit()`

### Дублирование событий

Если события дублируются, проверьте:

1. Что каждый инстанс использует уникальный `instanceId` (автоматически)
2. Что нет прямых вызовов `chatEvents.emit()` вместе с `emitChatMessage()`

### Redis connection errors

```
Redis error: ECONNREFUSED 127.0.0.1:6379
```

Решение: Убедитесь, что Redis сервер запущен и доступен по указанному URL.

## Зависимости

```json
{
  "ioredis": "^5.x"
}
```

Лицензия: MIT

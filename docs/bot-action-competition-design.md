# Bot Action Competition Design (Правило конкуренции активностей)

## Проблема
В одном чате может одновременно существовать несколько `bot_action` со статусом `processing` (разные `actionId`). Нужно формализовать поведение UI и логику выбора "текущей" активности.

## UX-правило конкуренции

### Основное правило
- **В UI показываем максимум одну строку индикатора** (`BotActionIndicatorRow`).
- **Текущая активность** = action со `status=processing` с самым свежим `updatedAt` (fallback: `startedAt`, если `updatedAt` отсутствует).
- **Никаких приоритетов по `actionType` нет** — только временная метка.

### Хранение состояния
- Фронтенд хранит **список всех активных actions** (где `status=processing`) в состоянии, даже если UI показывает одну строку.
- Структура: `Record<chatId, Record<actionId, BotAction>>` или `Record<chatId, BotAction[]>` (предпочтительно map по `actionId` для удобного обновления).

### Вычисление currentAction
Селектор `computeCurrentAction(chatId)`:
1. Берет все actions для `chatId` со `status=processing`.
2. Выбирает action с максимальным `updatedAt` (fallback: `startedAt` или `createdAt`).
3. Возвращает `currentAction` или `null`.

### Правила смены "текущей" активности

#### При получении start (новый action)
- Новый action добавляется в список активных.
- Он становится текущим (так как `updatedAt` самый свежий).
- UI переключается на показ нового action.

#### При получении update для не-текущего action
- Обновляем action в store по `actionId`.
- Если update переводит action в `done`/`error` — удаляем из списка активных (или помечаем статусом, селектор его не выберет).
- **Строку не переключаем**, если текущий action остаётся свежее и `processing`.

#### При получении done/error для текущего action
- Удаляем action из списка активных (или помечаем статусом).
- Пересчитываем `currentAction` селектором — выбираем следующую из оставшихся `processing` по `updatedAt`.
- Если активных больше нет — строка исчезает.

### Опциональный UI: счётчик "ещё N"
- Если `processing` actions больше одного — показываем рядом с текстом маленький бейдж "+N" (где N = количество остальных активных actions).
- На этом шаге **не делаем** список/дропдаун — только счётчик.

## Формула выбора currentAction

```typescript
function computeCurrentAction(
  actions: BotAction[],
  chatId: string
): BotAction | null {
  const active = actions
    .filter(a => a.chatId === chatId && a.status === "processing");
  
  if (active.length === 0) return null;
  
  // Сортируем по updatedAt desc, fallback на startedAt/createdAt
  const sorted = active.sort((a, b) => {
    const aTime = a.updatedAt 
      ? new Date(a.updatedAt).getTime()
      : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    const bTime = b.updatedAt
      ? new Date(b.updatedAt).getTime()
      : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
    return bTime - aTime; // desc
  });
  
  return sorted[0];
}
```

## Защита от out-of-order и гонок

### Совместимость с идемпотентностью (стора 7)
- `currentAction` выбирается по `updatedAt`.
- События для старого `actionId` не должны скрывать новый `processing`.
- Если пришёл `update(done)` для старого action, а текущий — новый `processing` — текущий остаётся.

### Примеры сценариев

#### Сценарий 1: Два processing одновременно
- Start A (processing, updatedAt: T1)
- Start B (processing, updatedAt: T2, T2 > T1)
- **Результат**: currentAction = B, UI показывает B
- Если есть счётчик: "+1" (A остаётся активным)

#### Сценарий 2: Завершение текущего
- Start A (processing, T1)
- Start B (processing, T2, T2 > T1) → current = B
- Update B (done, T3) → current переключается на A
- **Результат**: currentAction = A, UI показывает A

#### Сценарий 3: Late update для старого action
- Start A (processing, T1)
- Start B (processing, T2, T2 > T1) → current = B
- Update A (done, T3, но T3 < T2) → A удаляется из активных, но current остаётся B
- **Результат**: currentAction = B (не переключается на null)

#### Сценарий 4: Out-of-order события
- Start A (processing, T1)
- Start B (processing, T2, T2 > T1) → current = B
- Update A (done, T4, но пришёл позже) → A удаляется, current остаётся B
- Update B (done, T3, но пришёл раньше T4) → B удаляется, current переключается на null (A уже done)

## Чеклист сценариев конкуренции

### Ручная проверка
1. ✅ Два `start` подряд → в базе/сторе два `processing`, UI показывает последний (по `updatedAt`).
2. ✅ Завершить последний → UI переключился на первый.
3. ✅ Завершить первый → UI исчез (активных нет).
4. ✅ Late `update(done)` для старого action не скрывает новый `processing`.
5. ✅ Счётчик "+N" корректно показывает количество-1 (если добавлен).

### Тесты
- [ ] Два processing (A старый, B новый) → current = B
- [ ] B завершился → current переключился на A
- [ ] Late update(done) для A не должен скрыть B, если B свежее и processing
- [ ] Бейдж +N корректно показывает количество-1 (если добавлен)

## Бэкенд требования

### GET /api/chat/actions
- Возвращает **ТОЛЬКО** активные `status=processing` (если не указан другой `status` в query).
- Сортировка: `updatedAt desc` (или `startedAt desc`).
- Возвращает все нужные поля: `actionId`, `status`, `actionType`, `displayText`, `payload`, `updatedAt`, `createdAt`/`startedAt`.
- Поддерживает несколько `processing` одновременно (разные `actionId`) — это нормально.

### Правило бэкенда
- **Никаких ограничений "один action на чат"** на бэке не вводим.
- Конкуренцию решает фронтенд по правилу из этого design-note.
- `start` может создавать несколько `processing` одновременно — это нормально.

## No-code рекомендации

### Для авторов no-code сценариев
- Можно запускать несколько actions параллельно (разные `actionId`).
- Строка покажет "самую свежую" активность (по `updatedAt`).
- **Рекомендация** (не требование): чтобы избежать хаоса, в no-code сценариях лучше завершать старую активность (`update`) перед стартом новой.

### Примеры
```typescript
// ✅ Хорошо: последовательно
await startAction({ actionId: "uuid-1", actionType: "process_file" });
await doWork();
await updateAction({ actionId: "uuid-1", status: "done" });
await startAction({ actionId: "uuid-2", actionType: "transcribe_audio" });

// ⚠️ Допустимо, но может быть запутанно: параллельно
await Promise.all([
  startAction({ actionId: "uuid-1", actionType: "process_file" }),
  startAction({ actionId: "uuid-2", actionType: "transcribe_audio" }),
]);
// UI покажет тот, у которого updatedAt свежее
```

## Связь с другими сторами
- **Стора 7 (идемпотентность)**: правила идемпотентности сохраняются, конкуренция не ломает защиту от out-of-order.
- **Стора 5 (persistent activity)**: активные actions остаются в БД, фронт восстанавливает список при reconnect.


# Руководство по созданию и поддержке тестов

## Общие правила работы с тестовыми данными

### Использование test-helpers

Для создания тестовых пользователей и workspace используйте функции из `tests/test-helpers.ts`:

```typescript
import { createTestUser, createTestWorkspace, cleanupTestUser, cleanupTestUsers } from "./test-helpers";
```

### Паттерн для тестов с одним пользователем

```typescript
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestUser, createTestWorkspace, cleanupTestUser } from "./test-helpers";

describe("my test suite", () => {
  let userId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const user = await createTestUser(`my-test-${Date.now()}@example.com`);
    userId = user.id;
    workspaceId = `my-test-ws-${Date.now()}`;
    await createTestWorkspace(user.id, workspaceId);
  });

  afterAll(async () => {
    // Очистка: удаление пользователя автоматически удалит все связанные workspace
    await cleanupTestUser(userId);
  });

  it("should do something", async () => {
    // Ваш тест
  });
});
```

### Паттерн для тестов с несколькими пользователями

```typescript
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestUser, createTestWorkspace, cleanupTestUsers } from "./test-helpers";

describe("multi-user test suite", () => {
  let owner: PublicUser;
  let member: PublicUser;
  let workspaceId: string;

  beforeAll(async () => {
    owner = await createTestUser(`owner-${Date.now()}@example.com`);
    member = await createTestUser(`member-${Date.now()}@example.com`);
    workspaceId = `multi-user-ws-${Date.now()}`;
    await createTestWorkspace(owner.id, workspaceId);
  });

  afterAll(async () => {
    await cleanupTestUsers([owner.id, member.id]);
  });

  it("should handle multiple users", async () => {
    // Ваш тест
  });
});
```

### Паттерн для тестов с дополнительными пользователями в отдельных тестах

```typescript
describe("test suite with per-test users", () => {
  let userId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const user = await createTestUser(`main-${Date.now()}@example.com`);
    userId = user.id;
    workspaceId = `main-ws-${Date.now()}`;
    await createTestWorkspace(user.id, workspaceId);
  });

  afterAll(async () => {
    await cleanupTestUser(userId);
  });

  it("should work with additional user", async () => {
    const additionalUser = await createTestUser(`additional-${Date.now()}@example.com`);
    
    // Ваш тест
    
    // Очистка дополнительного пользователя
    await cleanupTestUser(additionalUser.id);
  });
});
```

## Важные правила

1. **Всегда используйте `Date.now()` в email'ах и ID**
   - Это обеспечивает уникальность данных при каждом запуске теста
   - Формат: `feature-${Date.now()}@example.com` или `feature-ws-${Date.now()}`

2. **Всегда добавляйте `afterAll` с очисткой**
   - Используйте `cleanupTestUser(userId)` для одного пользователя
   - Используйте `cleanupTestUsers([userId1, userId2])` для нескольких
   - Удаление пользователя автоматически удаляет все связанные workspace

3. **Не создавайте локальные функции `createUser` или `createWorkspaceForUser`**
   - Используйте `createTestUser` и `createTestWorkspace` из `test-helpers.ts`

4. **Сохраняйте `userId` в переменную**
   - Это необходимо для очистки в `afterAll`
   - Даже если userId не используется в тестах, он нужен для cleanup

## Очистка базы от старых тестовых данных

Если в базе накопились тестовые данные (пользователи с `@example.com` или workspace с timestamp в ID), используйте скрипт:

```bash
npx tsx scripts/cleanup-test-data.ts
```

Этот скрипт:
- Находит всех пользователей с email `@example.com`
- Находит все workspace с timestamp в ID (паттерн `-17xxxxx`)
- Удаляет их вместе со всеми связанными данными
- Выводит статистику удаленных записей

## Методы очистки в storage

В `server/storage.ts` доступны методы:

- `deleteUser(userId: string): Promise<boolean>` - удаляет пользователя и все связанные данные (workspace, где он owner, membership, invitations, tokens)
- `deleteWorkspace(workspaceId: string): Promise<boolean>` - удаляет workspace и все связанные данные (skills, knowledge bases, chats, files, actions, members, invitations)

Оба метода:
- Выполняют каскадное удаление
- Логируют статистику до и после удаления
- Предупреждают если остались orphaned записи
- Используют ON DELETE CASCADE для автоматической очистки связанных таблиц

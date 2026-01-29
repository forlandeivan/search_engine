import { storage } from "../server/storage";
import { users, workspaces } from "@shared/schema";
import { like } from "drizzle-orm";

/**
 * Скрипт для очистки тестовых данных из базы
 * Удаляет пользователей с email @example.com и их workspace'ы
 * Удаляет workspace'ы с timestamp в конце названия
 */
async function cleanupTestData() {
  console.log("🧹 Starting cleanup of test data...\n");

  // 1. Найти всех пользователей с @example.com
  const testUsers = await storage.db
    .select()
    .from(users)
    .where(like(users.email, "%@example.com"));

  console.log(`Found ${testUsers.length} test users with @example.com email`);

  // 2. Найти все workspace'ы с timestamp в конце (содержат -1769... в ID)
  const testWorkspaces = await storage.db
    .select()
    .from(workspaces)
    .where(like(workspaces.id, "%-17%"));

  console.log(`Found ${testWorkspaces.length} test workspaces with timestamp in ID\n`);

  // 3. Удалить workspace'ы
  let deletedWorkspaces = 0;
  for (const workspace of testWorkspaces) {
    try {
      const deleted = await storage.deleteWorkspace(workspace.id);
      if (deleted) {
        deletedWorkspaces++;
        console.log(`✅ Deleted workspace: ${workspace.id} (${workspace.name})`);
      }
    } catch (error) {
      console.error(`❌ Failed to delete workspace ${workspace.id}:`, error);
    }
  }

  console.log(`\n📊 Deleted ${deletedWorkspaces} workspaces\n`);

  // 4. Удалить пользователей
  let deletedUsers = 0;
  for (const user of testUsers) {
    try {
      const deleted = await storage.deleteUser(user.id);
      if (deleted) {
        deletedUsers++;
        console.log(`✅ Deleted user: ${user.email}`);
      }
    } catch (error) {
      console.error(`❌ Failed to delete user ${user.email}:`, error);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   - Deleted ${deletedUsers} test users`);
  console.log(`   - Deleted ${deletedWorkspaces} test workspaces`);
  console.log(`\n✨ Cleanup complete!`);

  process.exit(0);
}

// Запуск скрипта
cleanupTestData().catch((error) => {
  console.error("💥 Cleanup failed:", error);
  process.exit(1);
});

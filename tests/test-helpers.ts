import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import type { PublicUser } from "@shared/schema";

/**
 * Создает тестового пользователя
 */
export async function createTestUser(email: string): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Test User",
    firstName: "Test",
    lastName: "User",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });

  return {
    ...user,
    hasPersonalApiToken: false,
    personalApiTokenLastFour: null,
  };
}

/**
 * Создает workspace для пользователя
 */
export async function createTestWorkspace(
  userId: string,
  workspaceId: string,
  role: "owner" | "manager" | "user" = "owner"
) {
  const [workspace] = await storage.db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: `Test Workspace ${workspaceId}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(workspaceId, userId, role);
  return workspace;
}

/**
 * Удаляет тестового пользователя и все связанные данные
 */
export async function cleanupTestUser(userId: string) {
  try {
    await storage.deleteUser(userId);
  } catch (error) {
    console.error(`Failed to cleanup test user ${userId}:`, error);
  }
}

/**
 * Удаляет тестовый workspace и все связанные данные
 */
export async function cleanupTestWorkspace(workspaceId: string) {
  try {
    await storage.deleteWorkspace(workspaceId);
  } catch (error) {
    console.error(`Failed to cleanup test workspace ${workspaceId}:`, error);
  }
}

/**
 * Удаляет несколько пользователей
 */
export async function cleanupTestUsers(userIds: string[]) {
  await Promise.all(userIds.map((id) => cleanupTestUser(id)));
}

/**
 * Удаляет несколько workspaces
 */
export async function cleanupTestWorkspaces(workspaceIds: string[]) {
  await Promise.all(workspaceIds.map((id) => cleanupTestWorkspace(id)));
}

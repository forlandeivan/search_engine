import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test("Авторизация и проверка SessionResponse", async ({ page }) => {
  // Переходим на главную страницу
  await page.goto("/");

  // Ожидаем форму логина
  await page.waitForSelector("#login-email");

  // Заполняем форму логина
  await page.fill("#login-email", TEST_USER_EMAIL);
  await page.fill("#login-password", TEST_USER_PASSWORD);
  await page.getByTestId("button-login-submit").click();

  // Ждём перехода после авторизации (успешный логин редиректит)
  await page.waitForLoadState("networkidle");

  // Проверяем что мы авторизованы - запрашиваем session через API
  const sessionResponse = await page.request.get("/api/auth/session");
  expect(sessionResponse.ok(), "Session should be available after login").toBeTruthy();

  const session = await sessionResponse.json();
  
  // Проверяем структуру ответа
  expect(session, "Session should have user").toHaveProperty("user");
  expect(session.user, "User should have id").toHaveProperty("id");
  expect(session.user.id, "User id should not be empty").toBeTruthy();

  expect(session, "Session should have workspace").toHaveProperty("workspace");
  expect(session.workspace, "Workspace should have active").toHaveProperty("active");
  expect(session.workspace, "Workspace should have memberships").toHaveProperty("memberships");
  
  // Проверяем что active workspace существует
  expect(session.workspace.active, "Active workspace should exist").toBeTruthy();
  expect(session.workspace.active.id, "Active workspace should have id").toBeTruthy();
  expect(session.workspace.active.name, "Active workspace should have name").toBeTruthy();

  // Проверяем что memberships - массив
  expect(Array.isArray(session.workspace.memberships), "Memberships should be array").toBeTruthy();
  expect(session.workspace.memberships.length, "Should have at least one workspace").toBeGreaterThan(0);

  console.log("✅ Авторизация успешна!");
  console.log(`✅ User: ${session.user.email}`);
  console.log(`✅ Active workspace: ${session.workspace.active.name} (${session.workspace.active.id})`);
  console.log(`✅ Workspaces count: ${session.workspace.memberships.length}`);
});

import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test("пользователь может открыть чат и отправить сообщение", async ({ page }) => {
  await page.goto("/");

  await page.waitForSelector("#login-email");

  await page.fill("#login-email", TEST_USER_EMAIL);
  await page.fill("#login-password", TEST_USER_PASSWORD);
  await page.getByRole("button", { name: /^Войти$/ }).click();

  await page.getByTestId("link-чат").click();
  await expect(page).toHaveURL(/\/chat/);
  console.log("URL after navigating to chat:", await page.url());
  const workspaceId = await page.evaluate(() => window.__chatWorkspaceId);
  console.log("WorkspaceId detected on page:", workspaceId);
  await page.getByRole("button", { name: "Новый чат" }).click();
  await expect(page.getByText("Начните новый диалог")).toBeVisible();

  const message = "Сочини хокку";
  const input = page.getByPlaceholder(/Начните с первого вопроса|Введите сообщение/i).first();
  await input.fill(message);
  await page.getByRole("button", { name: "Отправить" }).click();

  await expect(page.getByText(message).first()).toBeVisible();
});

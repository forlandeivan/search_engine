import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test("Новый чат на базе Unica Chat", async ({ page }) => {
  await page.goto("/");

  await page.waitForSelector("#login-email");
  await page.fill("#login-email", TEST_USER_EMAIL);
  await page.fill("#login-password", TEST_USER_PASSWORD);
  await page.getByTestId("button-login-submit").click();

  await page.getByTestId("link-chat").click();
  await expect(page).toHaveURL(/\/chat$/);

  const workspaceId = await page.evaluate(() => (window as any).__chatWorkspaceId ?? null);
  console.log("WorkspaceId detected on page:", workspaceId);

  await page.getByTestId("button-new-chat").click();

  const message = "Привет! Как дела?";
  await page.getByTestId("input-chat-message").fill(message);

  await page.getByTestId("button-send-message").click();
  await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 10_000 });
  await expect(page.getByText(message).first()).toBeVisible();

  const chatUrl = await page.url();
  const chatIdMatch = chatUrl.match(/\/chat\/([^/?#]+)/);
  const chatId = chatIdMatch?.[1];
  expect(chatId, "chat id must be returned on creation").toBeTruthy();
  expect(workspaceId, "workspace id must be available").toBeTruthy();

  if (workspaceId && chatId) {
    const deleteResponse = await page.request.delete(
      `/api/chat/sessions/${chatId}?workspaceId=${workspaceId}`,
    );
    expect(deleteResponse.ok(), "chat cleanup must succeed").toBeTruthy();
  }
});

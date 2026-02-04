import { test } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_EMAIL || process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const E2E_PASSWORD = process.env.E2E_PASSWORD || process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test.describe("chat height debug", () => {
  test("open chat page and capture layout", async ({ page }) => {
    await page.goto("/");
    const emailEl = page.locator("#login-email");
    if (await emailEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailEl.fill(E2E_EMAIL);
      await page.locator("#login-password").fill(E2E_PASSWORD);
      await page.getByTestId("button-login-submit").click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      await page.waitForTimeout(2000);
    }

    // Чат доступен по /workspaces/:workspaceId/chat — переходим через дашборд или ссылку «Чат»
    await page.goto("/");
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
    await page.waitForTimeout(1500);
    // Клик по «Чат» в сайдбаре ведёт на /workspaces/:id/chat
    const chatLink = page.getByTestId("link-chat");
    if (await chatLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatLink.click();
      await page.waitForURL(/\/workspaces\/[^/]+\/chat/, { timeout: 10_000 });
    } else {
      const url = page.url();
      const m = url.match(/\/workspaces\/([^/]+)/);
      const workspaceId = m?.[1];
      if (workspaceId) await page.goto(`/workspaces/${workspaceId}/chat`);
    }

    await page.waitForLoadState("networkidle", { timeout: 10_000 });
    await page.waitForSelector('[data-testid="chat-page"]', { timeout: 10_000 }).catch(() => null);
    await page.waitForSelector('[data-testid="input-chat-message"]', { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(500);
    // Отправляем одно сообщение, чтобы увидеть «мало сообщений» по высоте
    await page.getByTestId("input-chat-message").fill("Проверка высоты чата");
    await page.getByTestId("button-send-message").click();
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: "e2e/screenshots/chat-height-debug.png",
      fullPage: false,
    });
  });
});

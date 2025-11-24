import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("LLM execution appears in admin journal with detail view", async ({ page }) => {
  test.setTimeout(120_000);

  await test.step("Авторизация администратора", async () => {
    await page.goto("/");
    await page.waitForSelector("#login-email");
    await page.fill("#login-email", TEST_USER_EMAIL);
    await page.fill("#login-password", TEST_USER_PASSWORD);
    await page.locator('form button[type="submit"]').first().click();
  });

  await test.step("Переход в раздел чата", async () => {
    await page.getByTestId("link-chat").click();
    await expect(page).toHaveURL(/\/chat$/);
  });

  const workspaceId = await page.evaluate(() => (window as any).__chatWorkspaceId ?? null);

  let chatId: string | null = null;
  const message = `LLM step journal ${Date.now()}`;

  await test.step("Создание нового чата и отправка сообщения", async () => {
    await page.getByTestId("button-new-chat").click();
    const captureChatCreation = page.waitForResponse(
      (response) =>
        response.url().includes("/api/chat/sessions") &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await page.getByTestId("input-chat-message").fill(message);
    await page.getByTestId("button-send-message").click();
    const chatCreationResponse = await captureChatCreation;
    const createdChat = (await chatCreationResponse.json()) as { chat?: { id: string } };
    chatId = createdChat.chat?.id ?? null;
    await expect(page.getByText(message).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step("Переход в журнал запусков и ожидание", async () => {
    await page.goto("/admin/llm-executions");
    await page.waitForURL(/\/admin\/llm-executions$/);
    await page.waitForTimeout(5000);
    await page.reload();
    await page.waitForURL(/\/admin\/llm-executions$/);
  });

  await test.step("Поиск записи по chatId и открытие деталей", async () => {
    expect(chatId, "chat session id must be defined").toBeTruthy();
    const rowRegex = new RegExp(escapeRegex(chatId!));
    await page.waitForFunction(
      (text) => {
        return Array.from(document.querySelectorAll("table tr")).some((row) =>
          row.textContent?.includes(text),
        );
      },
      chatId!,
      { timeout: 60_000 },
    );

    const executionRow = page.getByRole("row", { name: rowRegex }).first();
    await expect(executionRow).toBeVisible();
    await executionRow.click();

    await expect(page).toHaveURL(/\/admin\/llm-executions\/[0-9a-f-]+/i, { timeout: 10_000 });
    const panel = page.getByTestId("llm-execution-details-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(message)).toBeVisible();

    const detailUrl = page.url();
    await page.goto(detailUrl);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(message)).toBeVisible();
  });

  await test.step("Скриншот и очистка данных", async () => {
    await page.screenshot({
      path: `test-results/llm-executions-detail-${Date.now()}.png`,
      fullPage: true,
    });

    if (workspaceId && chatId) {
      const deleteResponse = await page.request.delete(`/api/chat/sessions/${chatId}?workspaceId=${workspaceId}`);
      expect(deleteResponse.ok(), "chat cleanup must succeed").toBeTruthy();
    }
  });
});

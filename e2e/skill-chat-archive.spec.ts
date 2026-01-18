import { test, expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_EMAIL || process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const E2E_PASSWORD = process.env.E2E_PASSWORD || process.env.TEST_USER_PASSWORD || "q1w2e3r4";

const login = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.click("#login-email", { clickCount: 3 });
  await page.fill("#login-email", E2E_EMAIL);
  await page.click("#login-password", { clickCount: 3 });
  await page.fill("#login-password", E2E_PASSWORD);
  await page.getByTestId("button-login-submit").click();
  
  // Ждём редиректа после логина - может быть редирект на dashboard или другую страницу
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  
  // Даём время для завершения логина (избегаем race condition)
  await page.waitForTimeout(3000);
};

test.describe("skill chat archive flow", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("creates skill, creates chat with message, archives skill", async ({ page }) => {
    // 1. Авторизация
    await login(page);
    console.log("✅ Авторизация выполнена");
    
    // Ждём полной загрузки приложения после авторизации
    await page.waitForLoadState("networkidle");

    // 2. Создание навыка
    await page.goto("/skills/new");
    // Ждём загрузки формы навыка - проверяем наличие ключевых элементов
    await page.waitForSelector('[data-testid="skill-name-input"]', { timeout: 20_000 });

    const skillName = `E2E Skill ${Date.now()}`;
    await page.getByTestId("skill-name-input").fill(skillName);
    await page.getByTestId("skill-description-input").fill("Тестовый навык для проверки полного цикла.");
    await page.getByTestId("skill-instruction-textarea").fill("Ты помощник. Отвечай кратко и по делу.");

    // Выбираем стандартный режим
    const standardCard = page.locator("label", { hasText: "Стандартный" }).first();
    await standardCard.click();

    // Настраиваем контекст
    const contextInput = page.getByTestId("skill-context-input-limit");
    await contextInput.fill("4096");

    // Выбираем модель
    await page.getByTestId("llm-model-select").click();
    const firstOption = page.locator("[role=option]").first();
    await firstOption.click();

    // Сохраняем навык
    const saveResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/api/skills") && response.request().method() === "POST";
    });
    await page.getByTestId("save-button").click();
    const saveResponse = await saveResponsePromise;
    const saveBody = await saveResponse.json();
    
    expect(saveResponse.status()).toBe(201);
    expect(saveBody.skill).toBeDefined();
    const createdSkillId = saveBody.skill.id as string;
    console.log(`✅ Навык создан: ${skillName} (${createdSkillId})`);

    // 3. Переход в чаты и создание чата в рамках навыка
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat$/);
    
    // Ждём загрузки сайдбара с навыками
    await page.waitForTimeout(2000);
    
    // Кликаем по навыку в сайдбаре для создания чата
    const skillListItem = page.getByTestId(`skill-list-item-${createdSkillId}`);
    await expect(skillListItem).toBeVisible({ timeout: 15_000 });
    
    // Ждём создания чата после клика
    const chatCreatedPromise = page.waitForURL(/\/chat\/[^/]+$/, { timeout: 10_000 });
    await skillListItem.click();
    await chatCreatedPromise;
    
    const chatUrl = page.url();
    const chatIdMatch = chatUrl.match(/\/chat\/([^/?#]+)/);
    const chatId = chatIdMatch?.[1];
    expect(chatId, "Chat ID should be in URL").toBeTruthy();
    console.log(`✅ Чат создан: ${chatId}`);

    // 4. Отправляем сообщение в чат
    const message = `Привет из e2e теста! Навык: ${skillName}`;
    await page.waitForSelector('[data-testid="input-chat-message"]', { timeout: 10_000 });
    await page.getByTestId("input-chat-message").fill(message);
    await page.getByTestId("button-send-message").click();

    // Ждём, что сообщение появилось
    await expect(page.getByText(message).first()).toBeVisible({ timeout: 15_000 });
    console.log(`✅ Сообщение отправлено: "${message}"`);

    // 5. Архивируем навык
    await page.goto("/skills");
    await expect(page).toHaveURL(/\/skills$/);

    // Находим строку навыка
    const skillRow = page.getByTestId(`skill-row-${createdSkillId}`);
    await expect(skillRow).toBeVisible({ timeout: 10_000 });

    // Открываем меню действий
    await skillRow.locator("button[aria-label='Действия с навыком']").click();
    await page.getByRole("menuitem", { name: "Архивировать" }).click();

    // Подтверждаем архивацию
    const archiveDialog = page.getByRole("dialog", { name: "Архивировать навык?" });
    await expect(archiveDialog).toBeVisible();

    const archiveResponsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes(`/api/skills/${createdSkillId}`) && 
        (response.request().method() === "PATCH" || response.request().method() === "DELETE")
      );
    });

    await archiveDialog.getByRole("button", { name: "Архивировать" }).click();
    const archiveResponse = await archiveResponsePromise;
    expect(archiveResponse.status()).toBe(200);

    // Проверяем, что навык исчез из списка
    await expect(skillRow).toHaveCount(0, { timeout: 5_000 });

    console.log(`✅ Навык ${skillName} архивирован`);
    console.log("✅ Весь сценарий выполнен успешно!");
  });
});

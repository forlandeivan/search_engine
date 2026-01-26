import { test, expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.click("#login-email", { clickCount: 3 });
  await page.fill("#login-email", E2E_EMAIL as string);
  await page.click("#login-password", { clickCount: 3 });
  await page.fill("#login-password", E2E_PASSWORD as string);
  
  const loginResponsePromise = page.waitForResponse((response) => {
    return response.url().includes("/api/auth/login") && response.request().method() === "POST";
  }, { timeout: 15_000 });
  
  await page.getByTestId("button-login-submit").click();
  const loginResponse = await loginResponsePromise;
  
  if (loginResponse.status() === 429) {
    throw new Error(`Rate limit exceeded for login`);
  }
  expect(loginResponse.status()).toBe(200);
  
  await page.waitForLoadState("networkidle", { timeout: 10_000 });
};

test.describe("crawl cancel widget", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should hide widget after canceling crawl", async ({ page }) => {
    // Авторизация
    await login(page);

    // Переходим на страницу знаний
    await page.goto("/knowledge");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    
    // Ждём появления селекта базы знаний
    await page.waitForSelector('select, [role="combobox"]', { timeout: 10_000 });

    // Нажимаем кнопку "Добавить знания" или создаем новую базу с краулингом
    // Сначала проверяем, есть ли кнопка создания базы
    const createBaseButton = page.getByRole("button", { name: /создать|добавить|новая/i }).first();
    if (await createBaseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createBaseButton.click();
    } else {
      // Ищем кнопку через другой способ
      const addButton = page.locator('button:has-text("Добавить"), button:has-text("Создать")').first();
      if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addButton.click();
      }
    }

    // Ждём появления диалога создания базы
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    
    // Выбираем режим "Краулинг сайта"
    const crawlerOption = page.getByText("Краулинг сайта").first();
    await crawlerOption.click();
    
    // Заполняем форму краулинга
    const urlInput = page.locator('input[type="url"], input[placeholder*="url" i], input[placeholder*="ссылк" i]').first();
    await urlInput.fill("https://example.com");
    
    // Заполняем название базы
    const nameInput = page.locator('input[placeholder*="название" i], input[placeholder*="name" i]').first();
    await nameInput.fill("Test Crawl Base");
    
    // Создаём базу знаний
    const createButton = page.getByRole("button", { name: /создать|готово|запустить/i }).last();
    await createButton.click();
    
    // Ждём появления виджета краулинга
    const crawlWidget = page.getByTestId("crawl-progress-widget");
    await crawlWidget.waitFor({ timeout: 10000 });
    
    // Проверяем, что виджет виден
    await expect(crawlWidget).toBeVisible();
    
    // Нажимаем кнопку "Отменить"
    const cancelButton = page.getByTestId("crawl-cancel-button");
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();
    
    // Ждём, пока джоба отменится (статус изменится на "canceled")
    // Виджет должен остаться видимым сразу после нажатия
    await expect(crawlWidget).toBeVisible();
    
    // Ждём 2.5 секунды - виджет должен скрыться через 2 секунды после отмены
    await page.waitForTimeout(2500);
    
    // Проверяем, что виджет скрылся
    await expect(crawlWidget).not.toBeVisible({ timeout: 1000 });
  });
});

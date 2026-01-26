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

test.describe("crawl widget switch simple", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should not show widget after cancel and switch", async ({ page }) => {
    // Авторизация
    await login(page);

    // Переходим на конкретную базу с отмененным краулингом
    const baseId = "6def48f4-040a-49fe-bdbd-f65313515ac8";
    await page.goto(`/knowledge/${baseId}`);
    
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    
    // Проверяем, что виджет НЕ виден (должен быть скрыт, так как краулинг отменен)
    const crawlWidget = page.getByTestId("crawl-progress-widget");
    const isWidgetVisible = await crawlWidget.isVisible({ timeout: 2000 }).catch(() => false);
    
    console.log(`Widget visible on first load: ${isWidgetVisible}`);
    
    if (isWidgetVisible) {
      const statusBadge = crawlWidget.locator('text=/Отменено/').first();
      const hasCanceledStatus = await statusBadge.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Has canceled status: ${hasCanceledStatus}`);
      
      if (hasCanceledStatus) {
        await page.screenshot({ path: "e2e/screenshots/crawl-widget-should-not-be-visible.png", fullPage: true });
        console.log("ERROR: Widget with canceled status is visible!");
      }
    }
    
    // Переключаемся на другую базу (через селект)
    const baseSelect = page.locator('select, [role="combobox"]').first();
    const options = await baseSelect.locator('option').all();
    
    if (options.length > 1) {
      // Выбираем другую базу
      for (const option of options) {
        const value = await option.getAttribute('value').catch(() => null);
        if (value && value !== baseId) {
          await baseSelect.selectOption(value);
          console.log(`Switched to base: ${value}`);
          await page.waitForTimeout(2000);
          break;
        }
      }
    }
    
    // Возвращаемся на исходную базу
    await baseSelect.selectOption(baseId);
    console.log(`Returned to base: ${baseId}`);
    await page.waitForTimeout(3000); // Ждём загрузки и polling
    
    // Проверяем, что виджет НЕ появился
    const widgetVisibleAfterReturn = await crawlWidget.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Widget visible after return: ${widgetVisibleAfterReturn}`);
    
    if (widgetVisibleAfterReturn) {
      const statusBadge = crawlWidget.locator('text=/Отменено/').first();
      const hasCanceledStatus = await statusBadge.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Has canceled status after return: ${hasCanceledStatus}`);
      await page.screenshot({ path: "e2e/screenshots/crawl-widget-appeared-after-return-simple.png", fullPage: true });
    }
    
    // Виджет НЕ должен быть виден
    await expect(crawlWidget).not.toBeVisible({ timeout: 1000 });
  });
});

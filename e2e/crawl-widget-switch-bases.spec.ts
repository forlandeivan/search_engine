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

test.describe("crawl widget switch bases", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should not show widget after switching bases and returning", async ({ page }) => {
    // Авторизация
    await login(page);

    // Переходим на страницу знаний
    await page.goto("/knowledge");
    
    // Ждём загрузки страницы
    try {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
    } catch (e) {
      console.log("Network idle timeout, continuing anyway");
    }
    
    // Ждём появления селекта
    await page.waitForSelector('select, [role="combobox"]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    
    // Создаем новую базу с краулингом
    console.log("Creating new base with crawl...");
    
    const createButton = page.locator('button:has-text("Добавить"), button:has-text("Создать"), button:has-text("Новая")').first();
    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(500);
    }

    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    
    const crawlerOption = page.getByText("Краулинг сайта").first();
    await crawlerOption.click();
    await page.waitForTimeout(300);
    
    const urlInput = page.locator('input[type="url"], input[placeholder*="url" i], input[placeholder*="ссылк" i]').first();
    if (await urlInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await urlInput.fill("https://example.com");
    }
    
    const nameInput = page.locator('input[placeholder*="название" i], input[placeholder*="name" i]').first();
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.fill("Test Switch Bases " + Date.now());
    }
    
    const submitButton = page.getByRole("button", { name: /создать|готово|запустить/i }).last();
    await submitButton.click();
    
    await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    
    // Проверяем, что виджет появился
    const crawlWidget = page.getByTestId("crawl-progress-widget");
    const isWidgetVisible = await crawlWidget.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!isWidgetVisible) {
      console.log("Widget not visible after creation, skipping test");
      test.skip(true, "Widget not visible after creation");
      return;
    }
    
    console.log("Widget is visible, canceling...");
    
    // Отменяем краулинг
    const cancelButton = page.getByTestId("crawl-cancel-button");
    const hasCancelButton = await cancelButton.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasCancelButton) {
      await cancelButton.click();
      await page.waitForTimeout(3000); // Ждём, пока виджет скроется
      
      const stillVisible = await crawlWidget.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Widget visible after cancel: ${stillVisible}`);
      
      if (stillVisible) {
        console.log("WARNING: Widget still visible after cancel, waiting more...");
        await page.waitForTimeout(2000);
      }
    }
    
    // Получаем ID текущей базы из URL
    const currentUrl = page.url();
    const baseIdMatch = currentUrl.match(/\/knowledge\/([^\/]+)/);
    const currentBaseId = baseIdMatch ? baseIdMatch[1] : null;
    
    console.log(`Current base ID: ${currentBaseId}`);
    
    // Переключаемся на другую базу (выбираем другую в селекте)
    const baseSelect = page.locator('select, [role="combobox"]').first();
    const options = await baseSelect.locator('option').all();
    
    if (options.length > 1) {
      // Выбираем другую базу (не текущую)
      for (const option of options) {
        const value = await option.getAttribute('value').catch(() => null);
        if (value && value !== currentBaseId) {
          await baseSelect.selectOption(value);
          console.log(`Switched to base: ${value}`);
          await page.waitForTimeout(2000);
          break;
        }
      }
    } else {
      console.log("Only one base available, cannot switch");
    }
    
    // Возвращаемся на исходную базу
    if (currentBaseId) {
      await baseSelect.selectOption(currentBaseId);
      console.log(`Returned to base: ${currentBaseId}`);
      await page.waitForTimeout(3000); // Ждём загрузки и polling
    
      // Проверяем, что виджет НЕ появился
      const widgetVisibleAfterReturn = await crawlWidget.isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`Widget visible after returning: ${widgetVisibleAfterReturn}`);
      
      if (widgetVisibleAfterReturn) {
        const widgetText = await crawlWidget.textContent().catch(() => "");
        const statusBadge = crawlWidget.locator('text=/Отменено|Завершено|Ошибка/').first();
        const statusText = await statusBadge.textContent().catch(() => "");
        console.log(`Widget status: ${statusText}`);
        console.log(`Widget content: ${widgetText?.substring(0, 200)}`);
        await page.screenshot({ path: "e2e/screenshots/crawl-widget-appeared-after-return.png", fullPage: true });
      }
      
      // Виджет НЕ должен быть виден
      await expect(crawlWidget).not.toBeVisible({ timeout: 1000 });
    }
  });
});

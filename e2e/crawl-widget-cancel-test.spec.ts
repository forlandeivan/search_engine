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

test.describe("crawl widget cancel test", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should hide widget 2 seconds after canceling active crawl", async ({ page }) => {
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
    
    // Ждём появления селекта или виджета
    await page.waitForSelector('select, [role="combobox"], [data-testid="crawl-progress-widget"]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    
    // Ищем виджет с активным краулингом (не отмененным)
    const crawlWidget = page.getByTestId("crawl-progress-widget");
    const isWidgetVisible = await crawlWidget.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (!isWidgetVisible) {
      // Если виджета нет, создаем новую базу с краулингом
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
        await nameInput.fill("Test Crawl Cancel " + Date.now());
      }
      
      const submitButton = page.getByRole("button", { name: /создать|готово|запустить/i }).last();
      await submitButton.click();
      
      await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 }).catch(() => {});
    }

    // Ждём появления виджета
    await crawlWidget.waitFor({ timeout: 15000 });
    await expect(crawlWidget).toBeVisible();
    
    // Проверяем, что есть кнопка "Отменить"
    const cancelButton = page.getByTestId("crawl-cancel-button");
    const hasCancelButton = await cancelButton.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!hasCancelButton) {
      // Если кнопки нет, возможно джоба уже завершена или отменена
      const statusBadge = crawlWidget.locator('text=/Отменено|Завершено|Ошибка/').first();
      const statusText = await statusBadge.textContent().catch(() => "");
      console.log(`Widget status: ${statusText}, cancel button not available`);
      test.skip(true, "No active crawl to cancel");
      return;
    }
    
    console.log("Clicking cancel button...");
    await cancelButton.click();
    
    // Ждём, пока статус изменится на "Отменено"
    await page.waitForTimeout(1000);
    
    const canceledBadge = page.locator('text="Отменено"').first();
    const isCanceled = await canceledBadge.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isCanceled) {
      console.log("Job is canceled, waiting for widget to hide...");
    }
    
    // Виджет должен остаться видимым сразу после нажатия
    await expect(crawlWidget).toBeVisible();
    console.log("Widget still visible after cancel (expected)");
    
    // Ждём 3 секунды - виджет должен скрыться через 2 секунды
    console.log("Waiting 3 seconds for widget to hide...");
    
    let widgetVisible = true;
    let checkCount = 0;
    const maxChecks = 8; // 8 * 500ms = 4 seconds max
    
    while (widgetVisible && checkCount < maxChecks) {
      await page.waitForTimeout(500);
      checkCount++;
      widgetVisible = await crawlWidget.isVisible({ timeout: 100 }).catch(() => false);
      console.log(`Check ${checkCount}: Widget visible = ${widgetVisible}`);
      
      if (!widgetVisible) {
        console.log(`Widget hidden after ${checkCount * 500}ms`);
        break;
      }
    }
    
    // Финальная проверка - виджет должен быть скрыт
    const finalVisible = await crawlWidget.isVisible({ timeout: 1000 }).catch(() => false);
    console.log(`Final check: Widget visible = ${finalVisible}`);
    
    if (finalVisible) {
      await page.screenshot({ path: "e2e/screenshots/crawl-widget-not-hidden-after-cancel.png", fullPage: true });
      console.log("Screenshot saved - widget should have been hidden");
    }
    
    await expect(crawlWidget).not.toBeVisible({ timeout: 1000 });
  });
});

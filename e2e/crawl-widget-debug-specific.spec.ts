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

test.describe("crawl widget debug specific base", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should check widget behavior on specific base", async ({ page }) => {
    // Включаем логирование консоли
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.text().includes("crawl") || msg.text().includes("cancel")) {
        console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
      }
    });

    // Авторизация
    await login(page);

    // Переходим на конкретную базу знаний
    const baseId = "6def48f4-040a-49fe-bdbd-f65313515ac8";
    await page.goto(`/knowledge/${baseId}`);
    
    // Ждём загрузки страницы
    try {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
    } catch (e) {
      console.log("Network idle timeout, continuing anyway");
    }
    
    // Ждём появления виджета или контента
    await page.waitForTimeout(2000);
    
    // Проверяем наличие виджета
    const crawlWidget = page.getByTestId("crawl-progress-widget");
    const isWidgetVisible = await crawlWidget.isVisible({ timeout: 2000 }).catch(() => false);
    
    console.log(`Widget visible: ${isWidgetVisible}`);
    
    if (isWidgetVisible) {
      // Получаем информацию о виджете
      const widgetText = await crawlWidget.textContent().catch(() => "");
      console.log("Widget content:", widgetText?.substring(0, 500));
      
      // Проверяем статус
      const statusBadge = crawlWidget.locator('text=/Отменено|Завершено|Ошибка|Выполняется|На паузе/').first();
      const statusText = await statusBadge.textContent().catch(() => "");
      console.log("Widget status:", statusText);
      
      // Проверяем наличие кнопки "Отменить"
      const cancelButton = page.getByTestId("crawl-cancel-button");
      const hasCancelButton = await cancelButton.isVisible({ timeout: 1000 }).catch(() => false);
      console.log("Cancel button visible:", hasCancelButton);
      
      // Делаем скриншот
      await page.screenshot({ path: "e2e/screenshots/crawl-widget-debug-specific.png", fullPage: true });
      console.log("Screenshot saved to e2e/screenshots/crawl-widget-debug-specific.png");
      
      // Ждём 5 секунд и проверяем, скрылся ли виджет
      console.log("Waiting 5 seconds to check if widget hides...");
      await page.waitForTimeout(5000);
      
      const stillVisible = await crawlWidget.isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Widget still visible after 5s: ${stillVisible}`);
      
      if (stillVisible && statusText?.includes("Отменено")) {
        console.log("ERROR: Widget with canceled status is still visible after 5 seconds!");
        await page.screenshot({ path: "e2e/screenshots/crawl-widget-still-visible-error.png", fullPage: true });
      }
    } else {
      console.log("Widget is not visible (expected if no crawl job or already hidden)");
    }
    
    // Проверяем сетевые запросы к API краулинга
    const crawlApiRequests: string[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/kb/") && url.includes("/crawl")) {
        crawlApiRequests.push(`${response.request().method()} ${url} - ${response.status()}`);
        try {
          const body = await response.json();
          console.log(`Crawl API response: ${JSON.stringify(body).substring(0, 300)}`);
        } catch (e) {
          // Игнорируем ошибки парсинга
        }
      }
    });
    
    // Ждём еще немного, чтобы увидеть все запросы
    await page.waitForTimeout(3000);
    
    console.log("Crawl API requests:", crawlApiRequests);
  });
});

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

test.describe("crawl cancel widget debug", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should hide widget after canceling crawl - debug", async ({ page }) => {
    // Включаем логирование консоли
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.text().includes("crawl") || msg.text().includes("cancel")) {
        console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`);
      }
    });

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
    
    // Ждём появления селекта базы знаний или любого контента страницы
    try {
      await page.waitForSelector('select, [role="combobox"], [data-testid="crawl-progress-widget"]', { timeout: 15_000 });
    } catch (e) {
      // Делаем скриншот для отладки
      await page.screenshot({ path: "e2e/screenshots/knowledge-page-timeout.png", fullPage: true });
      console.log("Screenshot saved - page might not be loaded");
      throw e;
    }

    // Ищем существующую базу с активным краулингом или создаем новую
    // Сначала проверяем, есть ли уже виджет краулинга
    const existingWidget = page.getByTestId("crawl-progress-widget");
    const hasExistingWidget = await existingWidget.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasExistingWidget) {
      // Создаем новую базу с краулингом
      console.log("Creating new base with crawl...");
      
      // Ищем кнопку создания базы
      const createButton = page.locator('button:has-text("Добавить"), button:has-text("Создать"), button:has-text("Новая")').first();
      if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createButton.click();
        await page.waitForTimeout(500);
      }

      // Ждём появления диалога создания базы
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      
      // Выбираем режим "Краулинг сайта"
      const crawlerOption = page.getByText("Краулинг сайта").first();
      await crawlerOption.click();
      await page.waitForTimeout(300);
      
      // Заполняем форму краулинга
      const urlInput = page.locator('input[type="url"], input[placeholder*="url" i], input[placeholder*="ссылк" i]').first();
      if (await urlInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await urlInput.fill("https://example.com");
      }
      
      // Заполняем название базы
      const nameInput = page.locator('input[placeholder*="название" i], input[placeholder*="name" i]').first();
      if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nameInput.fill("Test Crawl Base " + Date.now());
      }
      
      // Создаём базу знаний
      const submitButton = page.getByRole("button", { name: /создать|готово|запустить/i }).last();
      await submitButton.click();
      
      // Ждём закрытия диалога
      await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 }).catch(() => {});
    }

    // Ждём появления виджета краулинга
    const crawlWidget = page.getByTestId("crawl-progress-widget");
    await crawlWidget.waitFor({ timeout: 15000 });
    
    console.log("Widget is visible, checking cancel button...");
    
    // Проверяем, что виджет виден
    await expect(crawlWidget).toBeVisible();
    
    // Проверяем состояние виджета
    const widgetText = await crawlWidget.textContent().catch(() => "");
    console.log("Widget content:", widgetText?.substring(0, 300));
    
    // Проверяем, есть ли кнопка "Отменить"
    const cancelButton = page.getByTestId("crawl-cancel-button");
    const hasCancelButton = await cancelButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (!hasCancelButton) {
      // Если кнопки нет, возможно джоба уже завершена или отменена
      // Проверяем статус
      const statusBadge = crawlWidget.locator('text=/Отменено|Завершено|Ошибка|Выполняется|На паузе/').first();
      const statusText = await statusBadge.textContent().catch(() => "");
      console.log("Widget status:", statusText);
      
      // Если джоба уже отменена, проверяем, скрывается ли виджет
      if (statusText?.includes("Отменено")) {
        console.log("Job is already canceled, checking if widget hides...");
        // Ждём 3 секунды и проверяем, скрылся ли виджет
        await page.waitForTimeout(3000);
        const stillVisible = await crawlWidget.isVisible({ timeout: 1000 }).catch(() => false);
        console.log(`Widget still visible after 3s: ${stillVisible}`);
        if (stillVisible) {
          await page.screenshot({ path: "e2e/screenshots/crawl-widget-already-canceled.png", fullPage: true });
        }
        await expect(crawlWidget).not.toBeVisible({ timeout: 1000 });
        return; // Завершаем тест, так как джоба уже отменена
      }
      
      // Если джоба завершена или в другом состоянии, создаем новую с краулингом
      throw new Error(`Cancel button not found. Widget status: ${statusText}. Need to create a new crawl job.`);
    }
    
    console.log("Clicking cancel button...");
    await cancelButton.click();
    
    // Ждём, пока джоба отменится (статус изменится на "canceled")
    // Проверяем, что статус изменился на "Отменено"
    await page.waitForTimeout(1000);
    
    const canceledBadge = page.locator('text="Отменено"').first();
    const isCanceled = await canceledBadge.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isCanceled) {
      console.log("Job is canceled, waiting for widget to hide...");
    } else {
      console.log("Warning: Job status might not be 'canceled' yet");
    }
    
    // Виджет должен остаться видимым сразу после нажатия
    await expect(crawlWidget).toBeVisible();
    console.log("Widget still visible after cancel (expected)");
    
    // Ждём 3 секунды - виджет должен скрыться через 2 секунды после отмены
    console.log("Waiting 3 seconds for widget to hide...");
    
    // Проверяем каждые 500мс, чтобы увидеть, когда виджет скрывается
    let widgetVisible = true;
    let checkCount = 0;
    const maxChecks = 10; // 10 * 500ms = 5 seconds max
    
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
      // Делаем скриншот для отладки
      await page.screenshot({ path: "e2e/screenshots/crawl-widget-not-hidden.png", fullPage: true });
      console.log("Screenshot saved to e2e/screenshots/crawl-widget-not-hidden.png");
      
      // Проверяем состояние виджета
      const widgetText = await crawlWidget.textContent().catch(() => "");
      console.log("Widget content:", widgetText?.substring(0, 200));
    }
    
    // Тест должен провалиться, если виджет не скрылся
    await expect(crawlWidget).not.toBeVisible({ timeout: 1000 });
  });
});

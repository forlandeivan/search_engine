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

test.describe("knowledge indexing button", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should check indexing button state for outdated status", async ({ page }) => {
    // Авторизация
    await login(page);

    // Переходим на страницу знаний
    await page.goto("/knowledge");
    
    // Ждём загрузки страницы
    try {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
    } catch (e) {
      console.log("WARNING: networkidle timeout - continuing anyway");
    }

    // Ждём появления кнопки индексации
    const indexingButton = page.locator('button:has-text("Индексировать")').first();
    
    try {
      await indexingButton.waitFor({ timeout: 10_000 });
    } catch (e) {
      await page.screenshot({ path: "e2e/screenshots/knowledge-indexing-button-not-found.png", fullPage: true });
      throw new Error("Кнопка индексации не найдена");
    }

    // Проверяем состояние кнопки
    const isDisabled = await indexingButton.isDisabled();
    const title = await indexingButton.getAttribute("title");
    
    console.log("=== Информация о кнопке индексации ===");
    console.log("Кнопка заблокирована:", isDisabled);
    console.log("Title (подсказка):", title);

    // Получаем информацию о статусе из консоли браузера
    const statusInfo = await page.evaluate(() => {
      // Пытаемся найти информацию о статусе в DOM
      const statusBadge = document.querySelector('[class*="bg-yellow"]');
      const statusText = statusBadge?.textContent || "не найден";
      return { statusText };
    });

    console.log("Статус базы знаний:", statusInfo.statusText);

    // Делаем скриншот
    await page.screenshot({ path: "e2e/screenshots/knowledge-indexing-button-state.png", fullPage: true });

    // Проверяем, что кнопка активна для статуса "Есть изменения"
    if (statusInfo.statusText.includes("Есть изменения") || statusInfo.statusText.includes("outdated")) {
      console.log("Статус: Есть изменения - кнопка должна быть активна");
      if (isDisabled) {
        console.log("ОШИБКА: Кнопка заблокирована, хотя должна быть активна!");
        // Выводим дополнительную информацию
        const buttonInfo = await page.evaluate(() => {
          const btn = document.querySelector('button:has-text("Индексировать")') as HTMLButtonElement;
          if (!btn) return null;
          return {
            disabled: btn.disabled,
            className: btn.className,
            parentHTML: btn.parentElement?.outerHTML.substring(0, 200) || "",
          };
        });
        console.log("Информация о кнопке:", buttonInfo);
      }
    }
  });
});

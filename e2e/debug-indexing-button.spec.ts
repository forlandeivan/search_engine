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

test.describe("debug indexing button", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("debug indexing button state", async ({ page }) => {
    // Авторизация
    await login(page);

    // Переходим на страницу знаний
    await page.goto("/knowledge");
    
    // Ждём загрузки страницы
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // Получаем информацию о состоянии через консоль браузера
    const debugInfo = await page.evaluate(() => {
      // Ищем кнопку индексации
      const buttons = Array.from(document.querySelectorAll('button'));
      const indexingButton = buttons.find(btn => btn.textContent?.includes('Индексировать'));
      
      if (!indexingButton) {
        return { error: "Кнопка не найдена" };
      }

      // Получаем информацию о кнопке
      const buttonInfo = {
        disabled: (indexingButton as HTMLButtonElement).disabled,
        title: indexingButton.getAttribute('title'),
        className: indexingButton.className,
      };

      // Ищем статус базы знаний
      const statusBadges = Array.from(document.querySelectorAll('[class*="badge"], [class*="Badge"]'));
      const statusText = statusBadges
        .map(badge => badge.textContent?.trim())
        .find(text => text && (text.includes('Есть изменения') || text.includes('outdated') || text.includes('Актуальна')));

      return {
        buttonInfo,
        statusText: statusText || "не найден",
        allStatusTexts: statusBadges.map(b => b.textContent?.trim()).filter(Boolean),
      };
    });

    console.log("=== Debug информация ===");
    console.log(JSON.stringify(debugInfo, null, 2));

    // Делаем скриншот
    await page.screenshot({ path: "e2e/screenshots/debug-indexing-button.png", fullPage: true });

    // Если кнопка заблокирована, выводим предупреждение
    if (debugInfo.buttonInfo?.disabled) {
      console.log("\n⚠️ Кнопка заблокирована!");
      console.log("Причина (title):", debugInfo.buttonInfo.title);
    } else {
      console.log("\n✅ Кнопка активна");
    }
  });
});

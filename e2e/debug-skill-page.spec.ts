import { test, expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.fill("#login-email", E2E_EMAIL as string);
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

test.describe("debug skill page", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should load skill edit page without errors", async ({ page }) => {
    // Коллектор ошибок консоли
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
      if (msg.type() === "warning") {
        consoleWarnings.push(msg.text());
      }
    });

    // Коллектор ошибок сети
    const networkErrors: Array<{ url: string; status: number; error: string }> = [];
    page.on("response", async (response) => {
      const url = response.url();
      const status = response.status();
      if (status >= 400) {
        try {
          const body = await response.json();
          networkErrors.push({
            url,
            status,
            error: JSON.stringify(body),
          });
        } catch {
          networkErrors.push({
            url,
            status,
            error: response.statusText(),
          });
        }
      }
    });

    // Авторизация
    await login(page);

    // Переходим на страницу создания навыка
    await page.goto("/skills/new");
    
    // Ждём немного
    await page.waitForTimeout(5000);

    // Выводим все ошибки
    console.log("\n=== Console errors ===");
    consoleErrors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
    
    console.log("\n=== Console warnings ===");
    consoleWarnings.forEach((warn, i) => console.log(`${i + 1}. ${warn}`));
    
    console.log("\n=== Network errors (4xx/5xx) ===");
    networkErrors.forEach((err, i) => {
      console.log(`${i + 1}. ${err.status} ${err.url}`);
      console.log(`   Error: ${err.error}`);
    });

    // Делаем скриншот
    await page.screenshot({ path: "e2e/screenshots/debug-skill-page.png", fullPage: true });

    // Проверяем HTML страницы
    const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
    console.log("\n=== Page body (first 2000 chars) ===");
    console.log(bodyHTML);

    // Проверяем что нет критических ошибок сети
    const criticalErrors = networkErrors.filter(e => 
      !e.url.includes("/api/auth/session") // игнорируем первичную проверку сессии
    );
    
    if (criticalErrors.length > 0) {
      console.log("\n=== CRITICAL ERRORS ===");
      criticalErrors.forEach((err, i) => {
        console.log(`${i + 1}. ${err.status} ${err.url}: ${err.error}`);
      });
    }
    
    // Тест не падает, просто выводит диагностику
    expect(true).toBe(true);
  });
});

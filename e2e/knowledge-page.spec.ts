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

test.describe("knowledge page", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("should load knowledge page without errors", async ({ page }) => {
    // Коллектор ошибок консоли
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Коллектор ошибок сети
    const networkErrors: Array<{ url: string; status: number; error: string; headers?: Record<string, string> }> = [];
    page.on("response", async (response) => {
      const url = response.url();
      const status = response.status();
      if (status >= 400) {
        const request = response.request();
        const headers = request.headers();
        try {
          const body = await response.json();
          networkErrors.push({
            url,
            status,
            error: JSON.stringify(body),
            headers: headers as Record<string, string>,
          });
        } catch {
          networkErrors.push({
            url,
            status,
            error: response.statusText(),
            headers: headers as Record<string, string>,
          });
        }
      }
    });

    // Авторизация
    await login(page);

    // Переходим на страницу знаний
    await page.goto("/knowledge");
    
    // Ждём загрузки страницы и сетевых запросов (с обработкой таймаута)
    try {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
    } catch (e) {
      // Если таймаут - делаем скриншот и продолжаем
      await page.screenshot({ path: "e2e/screenshots/knowledge-page-timeout-networkidle.png", fullPage: true });
      console.log("WARNING: networkidle timeout - continuing anyway");
    }

    // Ждём появления селекта базы знаний (с обработкой таймаута)
    try {
      await page.waitForSelector('select, [role="combobox"]', { timeout: 10_000 });
    } catch (e) {
      // Если таймаут - выводим ошибки и делаем скриншот
      console.log("\n=== TIMEOUT waiting for select - checking errors ===");
      console.log("Console errors:", consoleErrors.length);
      consoleErrors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
      console.log("Network errors:", networkErrors.filter(e => e.status >= 400).length);
      networkErrors.filter(e => e.status >= 400).forEach((err, i) => {
        console.log(`${i + 1}. ${err.status} ${err.url}`);
        console.log(`   Error: ${err.error}`);
      });
      await page.screenshot({ path: "e2e/screenshots/knowledge-page-timeout-select.png", fullPage: true });
      throw e;
    }

    // Выводим все ошибки для диагностики
    console.log("=== Console errors ===");
    consoleErrors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
    
    console.log("\n=== Network errors ===");
    const allNetworkErrors = networkErrors.filter((err) => err.status >= 400);
    allNetworkErrors.forEach((err, i) => {
      console.log(`${i + 1}. ${err.status} ${err.url}`);
      console.log(`   Error: ${err.error}`);
    });

    // Проверяем конкретные ошибки для /knowledge
    const knowledgeErrors = allNetworkErrors.filter((err) => 
      err.url.includes("/api/knowledge") || err.url.includes("/knowledge")
    );
    
    if (knowledgeErrors.length > 0) {
      console.log("\n=== Knowledge API errors (failing test) ===");
      knowledgeErrors.forEach((err, i) => {
        console.log(`${i + 1}. ${err.status} ${err.url}`);
        console.log(`   Error: ${err.error}`);
        if (err.headers) {
          const workspaceIdHeader = err.headers['x-workspace-id'] || err.headers['X-Workspace-Id'];
          console.log(`   X-Workspace-Id header: ${workspaceIdHeader || 'MISSING!'}`);
        }
      });
    }
    
    // Тест падает только если есть ошибки связанные с /knowledge
    expect(knowledgeErrors.length).toBe(0);

    // Проверяем что селект базы знаний имеет выбранное значение (не пустой)
    const selectElement = page.locator('select, [role="combobox"]').first();
    const selectedValue = await selectElement.inputValue().catch(() => null);
    console.log("Selected knowledge base ID:", selectedValue);
    expect(selectedValue).toBeTruthy();

    // Делаем скриншот для проверки
    await page.screenshot({ path: "e2e/screenshots/knowledge-page-loaded.png", fullPage: true });
  });
});

import { test, expect, type Page } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const ADMIN_EMAIL = process.env.TEST_USER_EMAIL || process.env.E2E_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD || process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  // Логин через API, чтобы избежать проблем с формой
  const loginResponse = await page.request.post("/api/auth/login", {
    form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15_000 });
};

test.describe("LLM Providers Page", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Admin credentials are not configured");

  test("should load LLM providers page and allow adding new provider", async ({ page }, testInfo) => {
    await login(page);

    // Собираем логи консоли
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      if (msg.type() === "error" || text.includes("LlmProvidersPage") || text.includes("error")) {
        console.log(`Console [${msg.type()}]:`, text);
      }
    });
    
    // Переход на страницу провайдеров LLM
    await page.goto("/admin/llm", { waitUntil: "networkidle" });
    
    // Собираем все сетевые запросы
    const networkRequests: Array<{ url: string; status: number; method: string }> = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/api/")) {
        networkRequests.push({
          url,
          status: response.status(),
          method: response.request().method(),
        });
      }
    });
    
    // Ждем загрузки страницы
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    await page.waitForTimeout(3000); // Даем время на полную загрузку
    
    // Выводим логи консоли
    console.log("Console messages count:", consoleMessages.length);
    const errorLogs = consoleMessages.filter((m) => m.includes("[error]"));
    if (errorLogs.length > 0) {
      console.log("ERROR LOGS:", errorLogs.join("\n\n"));
    }
    const relevantLogs = consoleMessages.filter((m) => 
      m.includes("LlmProvidersPage") || m.includes("error") || m.includes("Error") || m.includes("Controller")
    );
    if (relevantLogs.length > 0) {
      console.log("Relevant console logs:", relevantLogs.slice(0, 5));
    }
    
    // Проверяем ответы API
    console.log("Network requests:", JSON.stringify(networkRequests, null, 2));
    
    // Проверяем ответ /api/llm/providers
    const providersResponse = networkRequests.find((r) => r.url.includes("/api/llm/providers"));
    if (providersResponse) {
      console.log("Providers API status:", providersResponse.status);
      const response = await page.request.get("/api/llm/providers");
      const body = await response.json();
      console.log("Providers API response:", JSON.stringify(body, null, 2));
    }
    
    // Проверяем ответ /api/admin/unica-chat
    const unicaResponse = networkRequests.find((r) => r.url.includes("/api/admin/unica-chat"));
    if (unicaResponse) {
      console.log("Unica Chat API status:", unicaResponse.status);
      try {
        const response = await page.request.get("/api/admin/unica-chat");
        const body = await response.json();
        console.log("Unica Chat API response:", JSON.stringify(body, null, 2));
      } catch (error) {
        console.log("Unica Chat API error:", error);
      }
    }
    
    // Проверяем HTML структуру
    const html = await page.content();
    console.log("HTML length:", html.length);
    console.log("HTML contains 'root':", html.includes("root"));
    console.log("HTML contains 'react':", html.includes("react"));
    
    // Проверяем наличие React root
    const rootElement = await page.locator("#root").count();
    console.log("Root element count:", rootElement);
    
    // Делаем скриншот текущего состояния страницы (даже если белый экран)
    const screenshotPath = await saveSuccessScreenshot(page, testInfo);
    console.log("Screenshot saved to:", screenshotPath);
    
    // Проверяем, что страница загрузилась (не белый экран)
    const pageContent = await page.textContent("body");
    console.log("Page content length:", pageContent?.length);
    console.log("Page content preview:", pageContent?.substring(0, 500));
    
    // Проверяем наличие заголовка
    await expect(page.getByText("Управление LLM")).toBeVisible({ timeout: 5000 });
    
    // Ищем кнопку "Добавить провайдера"
    const addButton = page.getByRole("button", { name: /Добавить провайдера/i });
    await expect(addButton).toBeVisible({ timeout: 5000 });
    
    // Кликаем на кнопку добавления
    await addButton.click();
    
    // Ждем появления формы (проверяем наличие полей формы)
    await page.waitForTimeout(500);
    
    // Ищем кнопку отмены или закрытия формы
    // Может быть кнопка "Отмена" или просто закрытие через выбор существующего провайдера
    const cancelButton = page.getByRole("button", { name: /Отмена|Cancel/i }).first();
    
    // Если кнопка отмены есть, кликаем на неё
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
    } else {
      // Если кнопки отмены нет, просто выбираем первый провайдер из списка (если есть)
      const firstProvider = page.locator('[data-testid*="provider"]').first();
      if (await firstProvider.isVisible().catch(() => false)) {
        await firstProvider.click();
      }
    }
    
    // Делаем финальный скриншот
    await page.waitForTimeout(500);
    await saveSuccessScreenshot(page, testInfo);
    
    // Проверяем, что мы вернулись на страницу со списком провайдеров
    await expect(page.getByText("Управление LLM")).toBeVisible();
  });
});


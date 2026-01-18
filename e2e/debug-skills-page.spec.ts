import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test("Debug: Navigate to /skills/new after login", async ({ page }) => {
  // 1. Логин
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.fill("#login-email", TEST_USER_EMAIL);
  await page.fill("#login-password", TEST_USER_PASSWORD);
  
  const loginResponsePromise = page.waitForResponse((response) => {
    return response.url().includes("/api/auth/login") && response.request().method() === "POST";
  });
  
  await page.getByTestId("button-login-submit").click();
  const loginResponse = await loginResponsePromise;
  
  expect(loginResponse.status()).toBe(200);
  console.log("✅ Login successful");
  
  // Ждём загрузки
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  console.log(`✅ Current URL after login: ${page.url()}`);
  
  // 2. Переход на /skills/new
  console.log("Navigating to /skills/new...");
  await page.goto("/skills/new");
  
  // Скриншот для отладки
  await page.screenshot({ path: 'debug-skills-new.png', fullPage: true });
  console.log("✅ Screenshot saved to debug-skills-new.png");
  
  // Выводим консольные логи
  page.on('console', msg => console.log('[Browser Console]', msg.text()));
  
  // Ждём загрузки страницы
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
  console.log(`✅ Current URL: ${page.url()}`);
  console.log(`✅ Page title: ${await page.title()}`);
  
  // Проверяем наличие элемента
  const hasSkillInput = await page.locator('[data-testid="skill-name-input"]').count();
  console.log(`Has skill-name-input: ${hasSkillInput > 0}`);
  
  if (hasSkillInput === 0) {
    const bodyText = await page.locator('body').innerText();
    console.log(`Body text (first 500 chars): ${bodyText.substring(0, 500)}`);
  }
});

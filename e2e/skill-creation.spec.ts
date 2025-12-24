import { test, expect, type Page } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.click("#login-email", { clickCount: 3 });
  await page.fill("#login-email", E2E_EMAIL as string);
  await page.click("#login-password", { clickCount: 3 });
  await page.fill("#login-password", E2E_PASSWORD as string);
  await page.getByTestId("button-login-submit").click();
  await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15_000 });
};

test.describe("skill creation", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("creates a standard skill with default settings", async ({ page }, testInfo) => {
    await login(page);

    await page.goto("/skills/new");
    await expect(page.getByTestId("skill-title")).toHaveText("Настройки навыка");

    const skillName = `E2E Standard Skill ${Date.now()}`;
    await page.getByTestId("skill-name-input").fill(skillName);
    await page.getByTestId("skill-description-input").fill("Автоматически созданный навык для проверки при стандартном режиме.");
    await page.getByTestId("skill-instruction-textarea").fill("Инструкция: отвечать максимально подробно, но кратко.");
    const standardCard = page.locator("label", { hasText: "Стандартный" }).first();
    await standardCard.click();

    const contextInput = page.getByTestId("skill-context-input-limit");
    await contextInput.fill("4096");

    await page.getByTestId("llm-model-select").click();
    const firstOption = page.locator("[role=option]").first();
    await firstOption.click();

    const saveResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/api/skills") && response.request().method() === "POST";
    });
    await page.getByTestId("save-button").click();
    const saveResponse = await saveResponsePromise;
    const saveBody = await saveResponse.json();
    expect(saveResponse.status()).toBe(201);
    expect(saveBody.skill).toBeDefined();
    await expect(page.getByTestId("skill-title")).toBeVisible();

    await saveSuccessScreenshot(page, testInfo);
  });
});

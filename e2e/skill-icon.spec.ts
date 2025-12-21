import { test, expect } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.describe("skills", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("skill icon persists after save and reload", async ({ page }, testInfo) => {
    await page.goto("/");

    await page.waitForSelector("#login-email");
    await page.fill("#login-email", E2E_EMAIL as string);
    await page.fill("#login-password", E2E_PASSWORD as string);
    await page.getByTestId("button-login-submit").click();

    await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15000 });

    await page.goto("/skills");

    const firstSkillRow = page.locator('[data-testid^="skill-row-"]').first();
    await expect(firstSkillRow).toBeVisible();
    await firstSkillRow.click();

    await expect(page.getByTestId("skill-title")).toBeVisible();

    await page.getByTestId("skill-icon-trigger").click();
    await page.getByTestId("skill-icon-option-Brain").click();
    await expect(page.getByTestId("skill-icon-label")).toHaveText("Brain");

    const saveResponse = page.waitForResponse((response) => {
      return response.url().includes("/api/skills/") && response.request().method() === "PUT";
    });
    await page.getByTestId("save-button").click();
    await saveResponse;

    await page.reload();
    await expect(page.getByTestId("skill-title")).toBeVisible();
    await expect(page.getByTestId("skill-icon-label")).toHaveText("Brain");

    await saveSuccessScreenshot(page, testInfo);
  });
});

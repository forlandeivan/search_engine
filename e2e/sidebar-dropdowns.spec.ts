import { test, expect, type Page } from "@playwright/test";

const TEST_USER_EMAIL =
  process.env.E2E_EMAIL || process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD =
  process.env.E2E_PASSWORD || process.env.TEST_USER_PASSWORD || "q1w2e3r4";

const login = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.fill("#login-email", TEST_USER_EMAIL);
  await page.fill("#login-password", TEST_USER_PASSWORD);

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/login") &&
      response.request().method() === "POST",
    { timeout: 15_000 }
  );

  await page.getByTestId("button-login-submit").click();
  const loginResponse = await loginResponsePromise;

  if (loginResponse.status() === 429) {
    throw new Error("Rate limit exceeded for login");
  }

  expect(loginResponse.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.goto("/");
  await page.waitForSelector('[data-sidebar="header"]', { timeout: 15_000 });
};

const expectMenuVisible = async (page: Page) => {
  const openMenus = page.locator('[role="menu"][data-state="open"]');
  await expect(openMenus).toHaveCount(1);
  const menu = openMenus.first();
  await expect(menu).toBeVisible();
  const itemCount = await menu.locator('[role="menuitem"]').count();
  expect(itemCount).toBeGreaterThan(0);

  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
};

test.describe("sidebar dropdowns", () => {
  test("workspace and user menus should open", async ({ page }) => {
    await login(page);

    const header = page.locator('[data-sidebar="header"]');
    const footer = page.locator('[data-sidebar="footer"]');

    await expect(header).toBeVisible();
    await expect(footer).toBeVisible();

    const workspaceTrigger = header.locator('[data-sidebar="menu-button"]').first();
    await workspaceTrigger.click();
    await expectMenuVisible(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);

    const userTrigger = footer.locator('[data-sidebar="menu-button"]').first();
    await userTrigger.click();
    await expectMenuVisible(page);

    const sidebarToggle = footer.locator('[data-testid="button-sidebar-toggle"]').first();
    await sidebarToggle.click();
    await page.waitForTimeout(200);

    await workspaceTrigger.click();
    await expectMenuVisible(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);

    await userTrigger.click();
    await expectMenuVisible(page);
  });
});

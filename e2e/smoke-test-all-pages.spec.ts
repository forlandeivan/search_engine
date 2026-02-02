import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

const USER_PAGES = [
  "/",
  "/knowledge",
  "/skills",
  "/workspaces/actions",
  "/chat",
  "/vector/collections",
  "/integrations/api",
  "/workspaces/settings",
  "/profile",
];

const ADMIN_PAGES = [
  "/admin/workspaces",
  "/admin/users",
  "/admin/storage",
  "/admin/embeddings",
  "/admin/llm",
  "/admin/models",
  "/admin/llm-executions",
  "/admin/guard-blocks",
  "/admin/billing",
  "/admin/usage-charges",
  "/admin/auth",
  "/admin/file-storage",
  "/admin/indexing-rules",
  "/admin/settings/smtp",
  "/admin/tts-stt",
  "/admin/asr-executions",
];

test.describe("Smoke test: All pages", () => {
  test.beforeEach(async ({ page }) => {
    // Авторизация перед каждым тестом
    await page.goto("/");
    if (await page.locator("#login-email").isVisible()) {
      await page.fill("#login-email", TEST_USER_EMAIL);
      await page.fill("#login-password", TEST_USER_PASSWORD);
      await page.getByTestId("button-login-submit").click();
      await page.waitForLoadState("networkidle");
    }
  });

  const checkPage = async (page, url: string) => {
    console.log(`Checking page: ${url}`);
    
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto(url);
    
    // Ждем либо контента, либо ошибки
    await Promise.race([
      page.waitForLoadState("networkidle"),
      page.waitForSelector("text=ErrorBoundary", { timeout: 5000 }).catch(() => {}),
      page.waitForSelector("text=Требуется обновление", { timeout: 5000 }).catch(() => {}),
    ]);

    // Проверяем на наличие ErrorBoundary на странице
    const errorBoundaryVisible = await page.locator("text=ErrorBoundary").isVisible();
    const reloadRequiredVisible = await page.locator("text=Требуется обновление").isVisible();
    const whiteScreen = await page.evaluate(() => document.body.innerHTML === "");

    expect(errorBoundaryVisible, `Page ${url} showed ErrorBoundary`).toBeFalsy();
    expect(reloadRequiredVisible, `Page ${url} showed "Reload Required" (ChunkLoadError)`).toBeFalsy();
    expect(whiteScreen, `Page ${url} is a white screen`).toBeFalsy();

    // Проверяем критические ошибки в консоли (Outdated Optimize Dep / Failed to fetch module)
    const criticalErrors = errors.filter(e => 
      e.includes("Failed to fetch dynamically imported module") || 
      e.includes("Outdated Optimize Dep") ||
      e.includes("error loading dynamically imported module")
    );

    expect(criticalErrors, `Page ${url} had critical console errors: ${criticalErrors.join(", ")}`).toHaveLength(0);
  };

  for (const url of USER_PAGES) {
    test(`User page: ${url}`, async ({ page }) => {
      await checkPage(page, url);
    });
  }

  for (const url of ADMIN_PAGES) {
    test(`Admin page: ${url}`, async ({ page }) => {
      await checkPage(page, url);
    });
  }
});

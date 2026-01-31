import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.TEST_USER_EMAIL || process.env.E2E_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD || process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  const loginResponse = await page.request.post("/api/auth/login", {
    form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();
  await page.reload();
};

const updateMaintenance = async (page: Page, data: Record<string, unknown>) => {
  const response = await page.request.put("/api/admin/settings/maintenance", { data });
  expect(response.ok()).toBeTruthy();
};

const resetMaintenance = async (page: Page) => {
  await updateMaintenance(page, {
    scheduledStartAt: null,
    scheduledEndAt: null,
    forceEnabled: false,
    messageTitle: "",
    messageBody: "",
    publicEta: null,
  });
};

test.describe("maintenance mode UI", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Admin credentials are not configured");

  test("shows scheduled banner", async ({ page }) => {
    await login(page);

    const now = Date.now();
    const scheduledStartAt = new Date(now + 60 * 60 * 1000).toISOString();
    const scheduledEndAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();

    try {
      await updateMaintenance(page, {
        scheduledStartAt,
        scheduledEndAt,
        forceEnabled: false,
        messageTitle: "Scheduled maintenance",
        messageBody: "Update planned",
        publicEta: "Soon",
      });

      await page.goto("/");
      await expect(page.getByTestId("maintenance-banner")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("maintenance-overlay")).toHaveCount(0);
    } finally {
      await resetMaintenance(page);
    }
  });

  test("shows overlay when active", async ({ page }) => {
    await login(page);

    try {
      await updateMaintenance(page, {
        scheduledStartAt: null,
        scheduledEndAt: null,
        forceEnabled: true,
        messageTitle: "Maintenance mode",
        messageBody: "We are updating the system",
        publicEta: "Later today",
      });

      await page.goto("/auth");
      await expect(page.getByTestId("maintenance-overlay")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("maintenance-banner")).toHaveCount(0);
    } finally {
      await resetMaintenance(page);
    }
  });

  test("allows admin to access maintenance settings during active mode", async ({ page }) => {
    await login(page);

    try {
      await updateMaintenance(page, {
        scheduledStartAt: null,
        scheduledEndAt: null,
        forceEnabled: true,
        messageTitle: "Maintenance mode",
        messageBody: "We are updating the system",
        publicEta: "Later today",
      });

      await page.goto("/admin/settings/maintenance");
      await expect(page.getByTestId("maintenance-overlay")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Режим обслуживания" })).toBeVisible({ timeout: 15_000 });
    } finally {
      await resetMaintenance(page);
    }
  });
});

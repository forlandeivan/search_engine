import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test.setTimeout(120_000);

test("Создание файлового провайдера с настраиваемым конфигом", async ({ page }) => {
  await page.goto("/");
  // Логин через API, чтобы избежать проблем с формой/перенаправлением
  const loginResponse = await page.request.post("/api/auth/login", {
    form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();

  // Открыть страницу провайдеров и форму создания
  await page.goto("/admin/file-storage");
  await expect(page).toHaveURL(/\/admin\/file-storage$/);
  await page.getByRole("button", { name: /^Создать$/ }).click();
  await expect(page).toHaveURL(/\/admin\/file-storage\/providers\/new/);

  // Заполнить поля
  const providerName = `E2E Provider ${Date.now()}`;
  await page.getByLabel("Название").fill(providerName);
  await page.getByLabel("Base URL").fill("https://aidev.hopper-it.ru/api/files/api");
  await page.getByLabel("Описание").fill("E2E test provider");
  await page.getByLabel("Path template").fill("/{workspaceId}/{objectKey}");
  await page.getByLabel("Поле файла").fill("file");
  await page.getByLabel("Поле metadata (опционально)").fill("metadata");
  await page.getByLabel("Ключ ответа").fill("fileUri");
  await page.getByLabel("Таймаут, мс").fill("100000");

  // Сохранить
  await page.getByRole("button", { name: "Сохранить" }).click();

  // Проверить тост и наличие в списке
  await expect(page.getByText("Провайдер создан", { exact: false })).toBeVisible({ timeout: 5000 });
  await expect(page).toHaveURL(/\/admin\/file-storage$/);
  await expect(page.getByText(providerName)).toBeVisible();
});

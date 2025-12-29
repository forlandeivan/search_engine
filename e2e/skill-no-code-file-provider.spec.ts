import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.TEST_USER_EMAIL || "forlandeivan@gmail.com";
const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD || "q1w2e3r4";

test.setTimeout(120_000);

test("Создание no-code навыка с провайдером файлов и архивирование", async ({ page }) => {
  // 1. Авторизация через API
  const login = await page.request.post("/api/auth/login", {
    form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();

  // Данные для навыка
  const skillName = `E2E No-code ${Date.now()}`;
  const scenarioUrl = `https://example.com/no-code/${Date.now()}`;
  const fileEventsUrl = `https://example.com/file-events/${Date.now()}`;

  // 2. Перейти на вкладку "Навыки"
  await page.goto("/skills");
  await expect(page).toHaveURL(/\/skills$/);

  // 3. Создать no-code навык с URL'ами
  await page.getByRole("button", { name: "Создать навык" }).click();
  await expect(page).toHaveURL(/\/skills\/new$/);
  await page.getByTestId("skill-name-input").fill(skillName);
  await page.getByTestId("skill-description-input").fill("E2E тест no-code навыка с внешним файло-хранилищем");
  await page.getByRole("radio", { name: /No-code/i }).click({ force: true });
  await page.getByLabel("URL сценария").fill(scenarioUrl);
  await page.getByLabel("File Events URL").fill(fileEventsUrl);

  // 4. Выбрать File Storage Provider - Unica AI dev
  await page.getByRole("combobox", { name: "File Storage Provider" }).click();
  await page.getByRole("option", { name: /Unica AI dev/ }).click();

  // 5. Сохранить навык и дождаться успешного ответа
  const savePromise = page.waitForResponse(
    (res) => res.url().includes("/api/skills") && res.status() === 200,
  );
  await page.getByRole("button", { name: "Сохранить" }).click();
  await savePromise;

  // Вернуться к списку и убедиться, что навык появился
  await page.goto("/skills");
  const skillRow = page.getByRole("button", { name: new RegExp(skillName) });
  await expect(skillRow).toBeVisible();

  // 6. Архивировать навык
  await skillRow.getByRole("button", { name: "Действия с навыком" }).click();
  await page.getByRole("menuitem", { name: "Архивировать" }).click();
  await page.getByRole("button", { name: "Архивировать" }).click();
  await expect(page.getByText("Навык архивирован", { exact: true }).first()).toBeVisible();
});

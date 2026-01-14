import { test, expect } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const ADMIN_EMAIL = process.env.TEST_USER_EMAIL || process.env.E2E_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD || process.env.E2E_PASSWORD;

const login = async (page: any) => {
  await page.goto("/");
  // Логин через API, чтобы избежать проблем с формой
  const loginResponse = await page.request.post("/api/auth/login", {
    form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15_000 });
};

test.describe("Knowledge Base Indexing Policy", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Admin credentials are not configured");

  test("сохраняет политику индексации баз знаний", async ({ page }, testInfo) => {
    await login(page);

    // Переход на страницу правил индексации
    await page.goto("/admin/indexing-rules", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/admin\/indexing-rules$/);

    // Переключение на вкладку "Базы знаний"
    const knowledgeBasesTab = page.getByRole("tab", { name: "Базы знаний" });
    await expect(knowledgeBasesTab).toBeVisible({ timeout: 5000 });
    await knowledgeBasesTab.click();

    // Ждем загрузки формы политики
    await expect(page.getByText("Профиль индексации баз знаний")).toBeVisible({ timeout: 5000 });

    // Ждем загрузки провайдеров и моделей
    await page.waitForTimeout(2000);

    // Проверяем, что провайдер выбран (если нет - выбираем первый доступный)
    const providerSelect = page.locator("#kb-indexing-embeddings-provider");
    await expect(providerSelect).toBeVisible({ timeout: 5000 });

    // Получаем текущие значения для проверки
    const chunkSizeInput = page.locator("#kb-indexing-chunk-size");
    const chunkOverlapInput = page.locator("#kb-indexing-chunk-overlap");

    await expect(chunkSizeInput).toBeVisible({ timeout: 5000 });
    await expect(chunkOverlapInput).toBeVisible({ timeout: 5000 });

    const currentChunkSize = await chunkSizeInput.inputValue();
    const currentChunkOverlap = await chunkOverlapInput.inputValue();

    // Выбираем новое значение размера чанка (увеличиваем на 100, если возможно)
    const newChunkSize = Math.min(parseInt(currentChunkSize || "800") + 100, 2000);
    await chunkSizeInput.fill(newChunkSize.toString());

    // Выбираем новое значение перекрытия (увеличиваем на 50, если возможно)
    const newChunkOverlap = Math.min(parseInt(currentChunkOverlap || "200") + 50, newChunkSize - 1);
    await chunkOverlapInput.fill(newChunkOverlap.toString());

    // Ждем немного для валидации формы
    await page.waitForTimeout(1000);

    // Сохраняем политику
    const saveButton = page.getByRole("button", { name: /Сохранить/i }).first();
    
    // Ждем, пока форма станет валидной и кнопка будет доступна
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    
    // Проверяем, что кнопка видима и не disabled
    await expect(saveButton).toBeVisible({ timeout: 5000 });

    // Ожидаем успешного ответа API (ставим ожидание ДО клика)
    const savePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/knowledge-base-indexing-policy") &&
        (response.request().method() === "PUT" || response.request().method() === "PATCH") &&
        response.status() === 200,
      { timeout: 30000 },
    );

    // Кликаем и ждем ответа одновременно
    await saveButton.click();
    const saveResponse = await savePromise;

    // Проверяем успешный ответ
    expect(saveResponse.ok()).toBeTruthy();
    const savedData = await saveResponse.json();
    expect(savedData.chunkSize).toBe(newChunkSize);
    expect(savedData.chunkOverlap).toBe(newChunkOverlap);

    // Проверяем сообщение об успешном сохранении
    await expect(page.getByText("Сохранено", { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Политика индексации баз знаний обновлена", { exact: false })).toBeVisible({
      timeout: 3000,
    });

    // Проверяем, что значения сохранились в форме (перезагружаем страницу)
    await page.reload();
    await expect(knowledgeBasesTab).toBeVisible({ timeout: 5000 });
    await knowledgeBasesTab.click();
    await expect(page.getByText("Профиль индексации баз знаний")).toBeVisible({ timeout: 5000 });

    // Ждем загрузки данных
    await page.waitForTimeout(2000);

    // Проверяем, что сохраненные значения отображаются
    const savedChunkSizeInput = page.locator("#kb-indexing-chunk-size");
    const savedChunkOverlapInput = page.locator("#kb-indexing-chunk-overlap");

    await expect(savedChunkSizeInput).toBeVisible({ timeout: 5000 });
    await expect(savedChunkOverlapInput).toBeVisible({ timeout: 5000 });

    const savedChunkSize = await savedChunkSizeInput.inputValue();
    const savedChunkOverlap = await savedChunkOverlapInput.inputValue();

    expect(parseInt(savedChunkSize)).toBe(newChunkSize);
    expect(parseInt(savedChunkOverlap)).toBe(newChunkOverlap);

    await saveSuccessScreenshot(page, testInfo);
  });

  test("не сохраняет политику с некорректными данными", async ({ page }) => {
    await login(page);

    await page.goto("/admin/indexing-rules", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/admin\/indexing-rules$/);

    // Переключение на вкладку "Базы знаний"
    const knowledgeBasesTab = page.getByRole("tab", { name: "Базы знаний" });
    await expect(knowledgeBasesTab).toBeVisible({ timeout: 5000 });
    await knowledgeBasesTab.click();

    await expect(page.getByText("Профиль индексации баз знаний")).toBeVisible({ timeout: 5000 });

    // Ждем загрузки формы
    await page.waitForTimeout(2000);

    const chunkSizeInput = page.locator("#kb-indexing-chunk-size");
    const chunkOverlapInput = page.locator("#kb-indexing-chunk-overlap");

    await expect(chunkSizeInput).toBeVisible({ timeout: 5000 });
    await expect(chunkOverlapInput).toBeVisible({ timeout: 5000 });

    // Пытаемся установить перекрытие больше размера чанка (невалидное значение)
    await chunkSizeInput.fill("500");
    await chunkOverlapInput.fill("600"); // Больше размера чанка

    // Ждем валидации
    await page.waitForTimeout(500);

    // Кнопка сохранения должна быть неактивна или форма должна показать ошибку
    const saveButton = page.getByRole("button", { name: /Сохранить/i }).first();
    
    // Проверяем, что кнопка неактивна или есть сообщение об ошибке
    const isDisabled = await saveButton.isDisabled().catch(() => false);
    const hasError = await page.getByText(/Перекрытие.*меньше.*размера/i).isVisible().catch(() => false);

    // Один из этих вариантов должен быть true
    expect(isDisabled || hasError).toBeTruthy();
  });
});


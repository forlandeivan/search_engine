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

const fetchWorkspaceId = async (page: Page) => {
  const sessionResponse = await page.request.get("/api/auth/session");
  const sessionPayload = await sessionResponse.json();
  return sessionPayload?.workspace?.active?.id ?? sessionPayload?.activeWorkspaceId ?? null;
};

test.describe("skill with knowledge base", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("creates a skill with knowledge base and archives it", async ({ page }, testInfo) => {
    await login(page);

    const workspaceId = await fetchWorkspaceId(page);
    expect(workspaceId, "workspace id must be available").toBeTruthy();

    // 1. Создать базу знаний
    const knowledgeBaseName = `E2E KB ${Date.now()}`;
    const createKbResponse = await page.request.post("/api/knowledge/bases", {
      headers: { "X-Workspace-Id": workspaceId },
      data: {
        name: knowledgeBaseName,
        description: "База знаний для e2e теста навыка",
      },
    });
    expect(createKbResponse.ok()).toBeTruthy();
    const kbBody = await createKbResponse.json();
    const knowledgeBaseId = kbBody.id as string;
    expect(knowledgeBaseId).toBeTruthy();

    // 2. Создать навык с выбором базы знаний
    await page.goto("/skills/new");
    await expect(page.getByTestId("skill-title")).toHaveText("Настройки навыка");

    const skillName = `E2E Skill with KB ${Date.now()}`;
    await page.getByTestId("skill-name-input").fill(skillName);
    await page.getByTestId("skill-description-input").fill("Навык с базой знаний для e2e теста");
    await page.getByTestId("skill-instruction-textarea").fill("Инструкция: используй базу знаний для ответов.");

    // Убедиться, что выбран стандартный режим
    await page.getByTestId("execution-mode-standard").click();
    
    // Дождаться, пока форма обновится
    await page.waitForTimeout(300);

    // Проверить, что секция "Источники и коллекции" видна
    await expect(page.getByText("Источники и коллекции")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Навык будет искать ответы в выбранных базах знаний и коллекциях")).toBeVisible();

    // Выбрать базу знаний
    const knowledgeBaseSelect = page.getByTestId("libraries-multiselect");
    await expect(knowledgeBaseSelect).toBeVisible({ timeout: 5000 });
    await knowledgeBaseSelect.click();

    // Дождаться появления списка баз знаний и выбрать созданную
    const kbOption = page.getByRole("option", { name: knowledgeBaseName });
    await expect(kbOption).toBeVisible({ timeout: 10000 });
    await kbOption.click();

    // Закрыть popover (если нужно)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Проверить, что база знаний выбрана
    await expect(knowledgeBaseSelect).toContainText(knowledgeBaseName, { timeout: 5000 });

    // Выбрать LLM модель
    await page.getByTestId("llm-model-select").click();
    const firstOption = page.locator("[role=option]").first();
    await firstOption.click();

    // 3. Сохранить навык
    const saveResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/api/skills") && response.request().method() === "POST";
    });
    await page.getByTestId("save-button").click();
    const saveResponse = await saveResponsePromise;
    const saveBody = await saveResponse.json();
    expect(saveResponse.status()).toBe(201);
    expect(saveBody.skill).toBeDefined();
    expect(saveBody.skill.knowledgeBaseIds).toContain(knowledgeBaseId);
    expect(saveBody.skill.mode).toBe("rag"); // Режим должен автоматически стать RAG

    await saveSuccessScreenshot(page, testInfo);

    // 4. Проверить, что навык создан и отображается в списке
    const createdSkillId = saveBody.skill.id as string;
    await page.goto("/skills");
    const skillRow = page.getByTestId(`skill-row-${createdSkillId}`);
    await expect(skillRow).toBeVisible();

    // 5. Архивировать навык
    await skillRow.locator("button[aria-label='Действия с навыком']").click();
    await page.getByRole("menuitem", { name: "Архивировать" }).click();

    const archiveDialog = page.getByRole("dialog", { name: "Архивировать навык?" });
    await expect(archiveDialog).toBeVisible();

    const archiveResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/api/skills/") && response.request().method() === "DELETE";
    });
    await archiveDialog.getByRole("button", { name: "Архивировать" }).click();
    const archiveResponse = await archiveResponsePromise;
    expect(archiveResponse.status()).toBe(200);

    await expect(page.getByTestId(`skill-row-${createdSkillId}`)).toHaveCount(0);

    // 6. Очистка: удалить базу знаний
    const deleteKbResponse = await page.request.delete(`/api/knowledge/bases/${knowledgeBaseId}`, {
      headers: { "X-Workspace-Id": workspaceId },
      data: { confirmation: knowledgeBaseName },
    });
    // Удаление может вернуть 200 или 204
    expect([200, 204]).toContain(deleteKbResponse.status());
  });
});


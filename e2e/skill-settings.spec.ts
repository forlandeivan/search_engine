import { test, expect, type Page } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const login = async (page: Page) => {
  await page.goto("/");
  await page.waitForSelector("#login-email");
  await page.fill("#login-email", E2E_EMAIL as string);
  await page.fill("#login-password", E2E_PASSWORD as string);
  await page.getByTestId("button-login-submit").click();
  await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15000 });
};

const fetchWorkspaceId = async (page: Page) => {
  const sessionResponse = await page.request.get("/api/auth/session");
  const sessionPayload = await sessionResponse.json();
  return sessionPayload?.workspace?.active?.id ?? sessionPayload?.activeWorkspaceId ?? null;
};

test.describe("skill settings", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("main settings save persists instruction and LLM params", async ({ page }, testInfo) => {
    await login(page);

    const workspaceId = await fetchWorkspaceId(page);
    expect(workspaceId, "workspace id must be available").toBeTruthy();

    const skillsResponse = await page.request.get("/api/skills", {
      headers: { "X-Workspace-Id": workspaceId },
    });
    const skillsPayload = await skillsResponse.json();
    const skills = (skillsPayload?.skills ?? []) as Array<{
      id: string;
      isSystem?: boolean;
      status?: string | null;
    }>;
    const editableSkill = skills.find((skill) => !skill.isSystem && skill.status !== "archived");
    if (!editableSkill) {
      testInfo.skip("No editable skills available");
    }

    await page.goto("/skills");
    const skillRow = page.getByTestId(`skill-row-${editableSkill!.id}`);
    await expect(skillRow).toBeVisible();
    await skillRow.click();

    const instructionValue = `E2E instruction ${Date.now()}`;
    await page.getByTestId("skill-instruction-textarea").fill(instructionValue);

    await page.getByTestId("llm-advanced-accordion").click();
    await page.getByTestId("llm-temperature-input").fill("0.9");
    await page.getByTestId("llm-max-tokens-input").fill("512");

    const saveResponse = page.waitForResponse((response) => {
      return response.url().includes("/api/skills/") && response.request().method() === "PUT";
    });
    await page.getByTestId("save-button").click();
    await saveResponse;

    await page.reload();
    await expect(page.getByTestId("skill-instruction-textarea")).toHaveValue(instructionValue);

    await page.getByTestId("llm-advanced-accordion").click();
    await expect(page.getByTestId("llm-temperature-input")).toHaveValue("0.9");
    await expect(page.getByTestId("llm-max-tokens-input")).toHaveValue("512");

    await saveSuccessScreenshot(page, testInfo);
  });

  test("layout matches requirements and dirty action bar toggles", async ({ page }, testInfo) => {
    await login(page);

    const workspaceId = await fetchWorkspaceId(page);
    expect(workspaceId, "workspace id must be available").toBeTruthy();

    const skillsResponse = await page.request.get("/api/skills", {
      headers: { "X-Workspace-Id": workspaceId },
    });
    const skillsPayload = await skillsResponse.json();
    const skills = (skillsPayload?.skills ?? []) as Array<{
      id: string;
      isSystem?: boolean;
      status?: string | null;
    }>;
    const editableSkill = skills.find((skill) => !skill.isSystem && skill.status !== "archived");
    if (!editableSkill) {
      testInfo.skip("No editable skills available");
    }

    await page.goto("/skills");
    const skillRow = page.getByTestId(`skill-row-${editableSkill!.id}`);
    await expect(skillRow).toBeVisible();
    await skillRow.click();

    await expect(page.getByTestId("skill-title")).toHaveText("Настройки навыка");
    await expect(page.getByTestId("skill-settings-tab-main")).toBeVisible();
    await expect(page.getByTestId("skill-settings-tab-transcription")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Действия" })).toBeVisible();

    const saveButton = page.getByTestId("save-button");
    await expect(saveButton).toHaveCount(0);

    const descriptionInput = page.getByTestId("skill-description-input");
    const initialDescription = await descriptionInput.inputValue();
    await descriptionInput.fill(`E2E layout check ${Date.now()}`);
    await expect(saveButton).toBeVisible();

    const cancelButton = page.getByRole("button", { name: "Отмена" });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    await expect(descriptionInput).toHaveValue(initialDescription);
    await expect(saveButton).toHaveCount(0);

    await page.getByTestId("skill-icon-trigger").click();
    await expect(page.getByText("Иконка навыка")).toBeVisible();
    await page.keyboard.press("Escape");

    await saveSuccessScreenshot(page, testInfo);
  });

  test("auto routes to LLM when no RAG sources selected", async ({ page }, testInfo) => {
    await login(page);

    const workspaceId = await fetchWorkspaceId(page);
    expect(workspaceId, "workspace id must be available").toBeTruthy();

    const skillsResponse = await page.request.get("/api/skills", {
      headers: { "X-Workspace-Id": workspaceId },
    });
    const skillsPayload = await skillsResponse.json();
    const skills = (skillsPayload?.skills ?? []) as Array<{
      id: string;
      isSystem?: boolean;
      status?: string | null;
      knowledgeBaseIds?: string[];
      ragConfig?: { collectionIds?: string[] | null } | null;
    }>;
    const llmSkill = skills.find((skill) => {
      if (skill.isSystem || skill.status === "archived") return false;
      const hasKnowledgeBases = (skill.knowledgeBaseIds ?? []).length > 0;
      const hasCollections = (skill.ragConfig?.collectionIds ?? []).length > 0;
      return !hasKnowledgeBases && !hasCollections;
    });
    if (!llmSkill) {
      testInfo.skip("No LLM-only skills available");
    }

    await page.getByTestId("link-chat").click();
    await page.getByTestId(`skill-list-item-${llmSkill!.id}`).click();

    const message = `LLM check ${Date.now()}`;
    const responsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/chat/sessions/") &&
        response.url().includes("/messages/llm") &&
        response.request().method() === "POST"
      );
    });

    await page.getByTestId("input-chat-message").fill(message);
    await page.getByTestId("button-send-message").click();

    await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 10_000 });
    const response = await responsePromise;
    const payload = await response.json();

    expect(payload.rag).toBeUndefined();

    await saveSuccessScreenshot(page, testInfo);

    const chatUrl = await page.url();
    const chatIdMatch = chatUrl.match(/\/chat\/([^/?#]+)/);
    const chatId = chatIdMatch?.[1];
    if (chatId && workspaceId) {
      await page.request.delete(`/api/chat/sessions/${chatId}?workspaceId=${workspaceId}`);
    }
  });

  test("auto routes to RAG when knowledge bases or collections selected", async ({ page }, testInfo) => {
    await login(page);

    const workspaceId = await fetchWorkspaceId(page);
    expect(workspaceId, "workspace id must be available").toBeTruthy();

    const skillsResponse = await page.request.get("/api/skills", {
      headers: { "X-Workspace-Id": workspaceId },
    });
    const skillsPayload = await skillsResponse.json();
    const skills = (skillsPayload?.skills ?? []) as Array<{
      id: string;
      isSystem?: boolean;
      status?: string | null;
      knowledgeBaseIds?: string[];
      ragConfig?: {
        collectionIds?: string[] | null;
        embeddingProviderId?: string | null;
        mode?: string | null;
      } | null;
    }>;
    const ragSkill = skills.find((skill) => {
      if (skill.isSystem || skill.status === "archived") return false;
      const hasKnowledgeBases = (skill.knowledgeBaseIds ?? []).length > 0;
      if (!hasKnowledgeBases) return false;
      if (!skill.ragConfig?.embeddingProviderId) return false;
      if (skill.ragConfig?.mode === "selected_collections" && (skill.ragConfig.collectionIds ?? []).length === 0) {
        return false;
      }
      return true;
    });
    if (!ragSkill) {
      testInfo.skip("No RAG-ready skills available");
    }

    await page.getByTestId("link-chat").click();
    await page.getByTestId(`skill-list-item-${ragSkill!.id}`).click();

    const message = `RAG check ${Date.now()}`;
    const responsePromise = page.waitForResponse((response) => {
      return (
        response.url().includes("/api/chat/sessions/") &&
        response.url().includes("/messages/llm") &&
        response.request().method() === "POST"
      );
    });

    await page.getByTestId("input-chat-message").fill(message);
    await page.getByTestId("button-send-message").click();

    await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 10_000 });
    const response = await responsePromise;
    const payload = await response.json();

    expect(payload.rag).toBeTruthy();
    expect(payload.rag?.knowledgeBaseId).toBeTruthy();

    await saveSuccessScreenshot(page, testInfo);

    const chatUrl = await page.url();
    const chatIdMatch = chatUrl.match(/\/chat\/([^/?#]+)/);
    const chatId = chatIdMatch?.[1];
    if (chatId && workspaceId) {
      await page.request.delete(`/api/chat/sessions/${chatId}?workspaceId=${workspaceId}`);
    }
  });
});



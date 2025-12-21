import { test, expect } from "@playwright/test";
import { saveSuccessScreenshot } from "./utils/success-screenshot";

const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test.describe("chat skills", () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "E2E credentials are not configured");

  test("renders real skill icons in chat list", async ({ page }, testInfo) => {
    await page.goto("/");

    await page.waitForSelector("#login-email");
    await page.fill("#login-email", E2E_EMAIL as string);
    await page.fill("#login-password", E2E_PASSWORD as string);
    await page.getByTestId("button-login-submit").click();

    await expect(page.getByTestId("link-chat")).toBeVisible({ timeout: 15000 });

    const sessionResponse = await page.request.get("/api/auth/session");
    const sessionPayload = await sessionResponse.json();
    const workspaceId =
      sessionPayload?.workspace?.active?.id ?? sessionPayload?.activeWorkspaceId ?? null;
    expect(workspaceId, "workspace id must be available").toBeTruthy();

    const skillsResponse = await page.request.get("/api/skills", {
      headers: { "X-Workspace-Id": workspaceId },
    });
    const skillsPayload = await skillsResponse.json();
    const skills = (skillsPayload?.skills ?? []) as Array<{
      id: string;
      icon?: string | null;
      isSystem?: boolean;
      status?: string | null;
    }>;
    const customSkills = skills.filter(
      (skill) => !skill.isSystem && skill.status !== "archived",
    );
    const skillWithIcon = customSkills.find((skill) => skill.icon);
    if (!skillWithIcon) {
      testInfo.skip("No custom skill with icon in workspace");
    }

    await page.getByTestId("link-chat").click();

    const skillItem = page.getByTestId(`skill-list-item-${skillWithIcon!.id}`);
    await expect(skillItem).toBeVisible();

    const skillIcon = skillItem.getByTestId("skill-icon");
    await expect(skillIcon).toHaveAttribute("data-fallback", "false");
    await expect(skillIcon).toHaveAttribute("data-icon-name", skillWithIcon!.icon as string);

    await saveSuccessScreenshot(page, testInfo);
  });
});

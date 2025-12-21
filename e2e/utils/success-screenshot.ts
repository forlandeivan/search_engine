import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

const toSafeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export async function saveSuccessScreenshot(page: Page, testInfo: TestInfo): Promise<string> {
  const defaultDir = path.join(process.cwd(), "e2e", ".screenshots");
  const baseDir = process.env.E2E_SCREENSHOT_DIR || defaultDir || path.join(os.tmpdir(), "codex-e2e-screenshots");
  await mkdir(baseDir, { recursive: true });

  const titlePath = typeof testInfo.titlePath === "function" ? testInfo.titlePath() : [];
  const titleParts = titlePath.length > 0 ? titlePath : [testInfo.title];
  const title = toSafeName(titleParts.join("-"));
  const project = toSafeName(testInfo.project.name || "project");
  const fileName = `${title}-${project}-${Date.now()}.png`;
  const fullPath = path.join(baseDir, fileName);

  await page.screenshot({ path: fullPath, fullPage: true });
  return fullPath;
}

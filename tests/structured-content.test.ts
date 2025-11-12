import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __test__ } from "../server/kb-crawler";

const FIXTURE_PATH = resolve(__dirname, "fixtures/business-processes.html");

describe("structured crawler", () => {
  it("builds markdown with anchors for business processes", async () => {
    const html = readFileSync(FIXTURE_PATH, "utf-8");

    const result = await __test__.extractStructuredContentFromHtml(
      html,
      "https://example.com/business-processes/",
      undefined,
      "Business Processes",
    );

    expect(result.stats.headingCount).toBeGreaterThanOrEqual(5);
    expect(result.markdown).toContain("## Business Processes Overview");
    expect(result.outLinks.some((url) => url.includes("https://example.com/contacts"))).toBe(true);
  });
});

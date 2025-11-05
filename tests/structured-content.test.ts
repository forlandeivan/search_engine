import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WebCrawler } from "../server/crawler";

const FIXTURE_PATH = resolve(__dirname, "fixtures/business-processes.html");

describe("structured crawler", () => {
  it("builds markdown with anchors for business processes", async () => {
    const crawler = new WebCrawler();
    const html = readFileSync(FIXTURE_PATH, "utf-8");

    const result = await crawler.extractStructuredContentFromHtml(
      html,
      "https://example.com/business-processes/",
      undefined,
      "Business Processes",
    );

    expect(result.stats.headingCount).toBeGreaterThanOrEqual(5);
    expect(result.markdown).toContain("# Business Processes Overview");

    const hasAnchoredSource = result.chunks.some((chunk) => {
      const sourceUrl = chunk.metadata?.sourceUrl ?? chunk.deepLink ?? "";
      return sourceUrl.includes("#");
    });

    expect(hasAnchoredSource).toBe(true);
  });
});

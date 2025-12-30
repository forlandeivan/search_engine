import { describe, expect, it } from "vitest";
import { sanitizeDisplayText } from "../../server/chat-service";

describe("sanitizeDisplayText", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeDisplayText("  Привет   мир  ")).toBe("Привет мир");
  });

  it("strips html tags", () => {
    expect(sanitizeDisplayText("<b>Текст</b>")).toBe("Текст");
  });

  it("returns null for empty after sanitize", () => {
    expect(sanitizeDisplayText("   ")).toBeNull();
    expect(sanitizeDisplayText("<div>   </div>")).toBeNull();
  });

  it("cuts to max length", () => {
    const long = "a".repeat(400);
    expect(sanitizeDisplayText(long, 100)?.length).toBe(100);
  });
});

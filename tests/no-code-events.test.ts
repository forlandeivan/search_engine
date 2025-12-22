import { describe, expect, it } from "vitest";
import { parseSyncFinalResponse } from "../server/no-code-events";

describe("parseSyncFinalResponse", () => {
  it("parses valid sync_final payload", () => {
    const payload = {
      mode: "sync_final",
      results: [
        { role: "assistant", text: "Привет", resultId: "r1", triggerMessageId: "m1" },
        { role: "user", text: "Спасибо", resultId: "r2" },
      ],
    };

    const parsed = parseSyncFinalResponse(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.results[0].resultId).toBe("r1");
    expect(parsed?.results[1].role).toBe("user");
  });

  it("returns null for invalid mode", () => {
    const payload = { mode: "other", results: [] };
    expect(parseSyncFinalResponse(payload)).toBeNull();
  });

  it("returns null when resultId is missing", () => {
    const payload = {
      mode: "sync_final",
      results: [{ role: "assistant", text: "ok" }],
    };
    expect(parseSyncFinalResponse(payload)).toBeNull();
  });

  it("returns null on empty results", () => {
    const payload = { mode: "sync_final", results: [] };
    expect(parseSyncFinalResponse(payload)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_TARIFFS } from "../server/tariff-seed";

describe("tariff seed config", () => {
  it("all plans share the same limit_key matrix", () => {
    const planKeys = DEFAULT_TARIFFS.map((p) => ({
      code: p.code,
      keys: p.limits.map((l) => l.key).sort(),
    }));

    const uniqueKeySets = new Set(planKeys.map((p) => p.keys.join("|")));
    expect(uniqueKeySets.size).toBe(1);
  });
});

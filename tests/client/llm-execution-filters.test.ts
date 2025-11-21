import { describe, expect, it } from "vitest";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { buildExecutionListParams, type ExecutionFilterState } from "../../client/src/lib/llm-execution-filters";

describe("buildExecutionListParams", () => {
  it("normalizes date range boundaries to start/end of day", () => {
    const from = new Date("2025-01-10T10:15:00.000Z");
    const to = addDays(from, 2);
    const filters: ExecutionFilterState = {
      workspaceId: "",
      skillId: "",
      userId: "",
      status: "",
      hasError: false,
    };

    const params = buildExecutionListParams({ from, to }, filters, 1, 20);

    expect(new Date(params.from as Date).toISOString()).toBe(startOfDay(from).toISOString());
    expect(new Date(params.to as Date).toISOString()).toBe(endOfDay(to).toISOString());
  });

  it("applies filters only when values are provided", () => {
    const filters: ExecutionFilterState = {
      workspaceId: "workspace-1",
      skillId: "skill-1",
      userId: "user-1",
      status: "error",
      hasError: true,
    };

    const params = buildExecutionListParams(null, filters, 3, 50);

    expect(params.workspaceId).toBe("workspace-1");
    expect(params.skillId).toBe("skill-1");
    expect(params.userId).toBe("user-1");
    expect(params.status).toBe("error");
    expect(params.hasError).toBe(true);
    expect(params.page).toBe(3);
    expect(params.pageSize).toBe(50);
  });

  it("omits empty values from params", () => {
    const filters: ExecutionFilterState = {
      workspaceId: "",
      skillId: "",
      userId: "",
      status: "",
      hasError: false,
    };

    const params = buildExecutionListParams(null, filters, 2, 10);

    expect(params).not.toHaveProperty("workspaceId");
    expect(params).not.toHaveProperty("skillId");
    expect(params).not.toHaveProperty("userId");
    expect(params).not.toHaveProperty("status");
    expect(params).not.toHaveProperty("hasError");
    expect(params.page).toBe(2);
    expect(params.pageSize).toBe(10);
  });
});

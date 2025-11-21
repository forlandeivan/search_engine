/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLlmExecutionFiltersState } from "../../client/src/hooks/useLlmExecutionFiltersState";

describe("useLlmExecutionFiltersState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies hasError flag to params", () => {
    const { result } = renderHook(() => useLlmExecutionFiltersState());

    act(() => {
      result.current.setHasError(true);
    });

    expect(result.current.params.hasError).toBe(true);
  });

  it("debounces and trims user input", () => {
    const { result } = renderHook(() => useLlmExecutionFiltersState());

    act(() => {
      result.current.setUserInput("  user-123  ");
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.params.userId).toBe("user-123");
  });

  it("resets filters to defaults", () => {
    const { result } = renderHook(() => useLlmExecutionFiltersState());

    act(() => {
      result.current.setWorkspaceId("workspace-1");
      result.current.setSkillId("skill-1");
      result.current.setStatus("error");
      result.current.setHasError(true);
    });
    expect(result.current.params.workspaceId).toBe("workspace-1");

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.params.workspaceId).toBeUndefined();
    expect(result.current.params.skillId).toBeUndefined();
    expect(result.current.params.status).toBeUndefined();
    expect(result.current.params.hasError).toBeUndefined();
  });
});

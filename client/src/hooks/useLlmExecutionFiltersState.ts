import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { buildExecutionListParams, type ExecutionFilterState } from "@/lib/llm-execution-filters";
import type { LlmExecutionListParams } from "@/types/llm-execution";

export const DEFAULT_EXECUTIONS_PAGE_SIZE = 20;
export const DEFAULT_EXECUTIONS_DAYS = 7;

function useInitialRange(defaultDays: number): DateRange {
  return useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - defaultDays * 24 * 60 * 60 * 1000);
    return { from, to };
  }, [defaultDays]);
}

export interface LlmExecutionFiltersState {
  params: LlmExecutionListParams;
  dateRange: DateRange;
  filters: ExecutionFilterState;
  page: number;
  userInput: string;
  setDateRange: (range: DateRange) => void;
  setWorkspaceId: (workspaceId: string) => void;
  setSkillId: (skillId: string) => void;
  setStatus: (status: string) => void;
  setHasError: (hasError: boolean) => void;
  setPage: (page: number) => void;
  setUserInput: (value: string) => void;
  resetFilters: () => void;
  defaultRange: DateRange;
}

export function useLlmExecutionFiltersState(
  options: { pageSize?: number; defaultDays?: number } = {},
): LlmExecutionFiltersState {
  const pageSize = options.pageSize ?? DEFAULT_EXECUTIONS_PAGE_SIZE;
  const defaultDays = options.defaultDays ?? DEFAULT_EXECUTIONS_DAYS;
  const defaultRange = useInitialRange(defaultDays);
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ExecutionFilterState>({
    workspaceId: "",
    skillId: "",
    userId: "",
    status: "",
    hasError: false,
  });
  const [userInput, setUserInput] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const normalized = userInput.trim();
      setFilters((prev) => {
        if (prev.userId === normalized) {
          return prev;
        }
        setPage(1);
        return { ...prev, userId: normalized };
      });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [userInput]);

  const params = useMemo(
    () => buildExecutionListParams(dateRange, filters, page, pageSize),
    [dateRange, filters, page, pageSize],
  );

  const updateFilter = <K extends keyof ExecutionFilterState>(key: K, value: ExecutionFilterState[K]) => {
    setFilters((prev) => {
      if (prev[key] === value) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
    setPage(1);
  };

  const resetFilters = () => {
    setDateRange(defaultRange);
    setFilters({
      workspaceId: "",
      skillId: "",
      userId: "",
      status: "",
      hasError: false,
    });
    setUserInput("");
    setPage(1);
  };

  return {
    params,
    dateRange,
    filters,
    page,
    userInput,
    setDateRange: (range) => {
      setDateRange(range);
      setPage(1);
    },
    setWorkspaceId: (workspaceId) => updateFilter("workspaceId", workspaceId),
    setSkillId: (skillId) => updateFilter("skillId", skillId),
    setStatus: (status) => updateFilter("status", status),
    setHasError: (hasError) => updateFilter("hasError", hasError),
    setPage,
    setUserInput,
    resetFilters,
    defaultRange,
  };
}

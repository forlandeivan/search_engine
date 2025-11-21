import { endOfDay, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import type { LlmExecutionListParams, LlmExecutionStatus } from "@/types/llm-execution";

export interface ExecutionFilterState {
  workspaceId: string;
  skillId: string;
  userId: string;
  status: LlmExecutionStatus | "";
  hasError: boolean;
}

export function buildExecutionListParams(
  range: DateRange | null,
  filters: ExecutionFilterState,
  page: number,
  pageSize: number,
): LlmExecutionListParams {
  const params: LlmExecutionListParams = {
    page,
    pageSize,
  };

  if (range?.from) {
    params.from = startOfDay(range.from);
  }

  const rangeEnd = range?.to ?? range?.from ?? null;
  if (rangeEnd) {
    params.to = endOfDay(rangeEnd);
  }

  if (filters.workspaceId) {
    params.workspaceId = filters.workspaceId;
  }
  if (filters.skillId) {
    params.skillId = filters.skillId;
  }
  if (filters.userId) {
    params.userId = filters.userId;
  }
  if (filters.status) {
    params.status = filters.status;
  }
  if (filters.hasError) {
    params.hasError = true;
  }

  return params;
}

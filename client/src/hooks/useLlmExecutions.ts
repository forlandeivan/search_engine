import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  LlmExecutionDetail,
  LlmExecutionListParams,
  LlmExecutionListResponse,
} from "@/types/llm-execution";

const LLM_EXECUTIONS_QUERY_KEY = ["admin", "llm-executions"] as const;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

function serializeDate(value?: string | Date) {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function buildQueryString(params: LlmExecutionListParams): string {
  const search = new URLSearchParams();

  const from = serializeDate(params.from);
  const to = serializeDate(params.to);

  if (from) search.set("from", from);
  if (to) search.set("to", to);
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.skillId) search.set("skillId", params.skillId);
  if (params.userId) search.set("userId", params.userId);
  if (params.status) search.set("status", params.status);
  if (typeof params.hasError === "boolean") search.set("hasError", String(params.hasError));
  search.set("page", String(params.page ?? DEFAULT_PAGE));
  search.set("pageSize", String(params.pageSize ?? DEFAULT_PAGE_SIZE));

  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function fetchLlmExecutions(
  params: LlmExecutionListParams = {},
): Promise<LlmExecutionListResponse> {
  const query = buildQueryString(params);
  const response = await apiRequest("GET", `/api/admin/llm-executions${query}`);
  return (await response.json()) as LlmExecutionListResponse;
}

export async function fetchLlmExecutionDetails(
  executionId: string,
): Promise<LlmExecutionDetail> {
  const response = await apiRequest("GET", `/api/admin/llm-executions/${executionId}`);
  return (await response.json()) as LlmExecutionDetail;
}

export function useLlmExecutionsList(params: LlmExecutionListParams = {}) {
  const query = useQuery<LlmExecutionListResponse, Error>({
    queryKey: [...LLM_EXECUTIONS_QUERY_KEY, params],
    queryFn: () => fetchLlmExecutions(params),
  });

  return {
    executions: query.data?.items ?? [],
    pagination: query.data
      ? {
          page: query.data.page,
          pageSize: query.data.pageSize,
          total: query.data.total,
        }
      : { page: params.page ?? DEFAULT_PAGE, pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE, total: 0 },
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useLlmExecutionDetails(
  executionId: string | null,
  options: { enabled?: boolean } = {},
) {
  const enabled = Boolean(executionId) && (options.enabled ?? true);
  const query = useQuery<LlmExecutionDetail, Error>({
    queryKey: [...LLM_EXECUTIONS_QUERY_KEY, executionId],
    queryFn: () => fetchLlmExecutionDetails(executionId!),
    enabled,
  });

  return {
    execution: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

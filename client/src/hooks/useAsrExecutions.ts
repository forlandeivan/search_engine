import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  AsrExecutionDetail,
  AsrExecutionListParams,
  AsrExecutionListResponse,
} from "@/types/asr-execution";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const QUERY_KEY = ["admin", "asr-executions"] as const;

function serializeDate(value?: string | Date) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function buildQueryString(params: AsrExecutionListParams): string {
  const search = new URLSearchParams();
  const from = serializeDate(params.from);
  const to = serializeDate(params.to);
  if (from) search.set("from", from);
  if (to) search.set("to", to);
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.skillId) search.set("skillId", params.skillId);
  if (params.chatId) search.set("chatId", params.chatId);
  if (params.status) search.set("status", params.status);
  if (params.provider) search.set("provider", params.provider);
  search.set("page", String(params.page ?? DEFAULT_PAGE));
  search.set("pageSize", String(params.pageSize ?? DEFAULT_PAGE_SIZE));
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function fetchAsrExecutions(params: AsrExecutionListParams = {}) {
  const query = buildQueryString(params);
  const response = await apiRequest("GET", `/api/admin/asr-executions${query}`);
  return (await response.json()) as AsrExecutionListResponse;
}

export async function fetchAsrExecutionDetail(executionId: string) {
  const response = await apiRequest("GET", `/api/admin/asr-executions/${executionId}`);
  return (await response.json()) as AsrExecutionDetail;
}

export function useAsrExecutionsList(params: AsrExecutionListParams = {}) {
  const query = useQuery<AsrExecutionListResponse, Error>({
    queryKey: [...QUERY_KEY, params],
    queryFn: () => fetchAsrExecutions(params),
  });

  return {
    executions: query.data?.executions ?? [],
    pagination: query.data?.pagination ?? { 
      page: params.page ?? DEFAULT_PAGE, 
      pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE, 
      total: 0 
    },
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useAsrExecutionDetail(executionId: string | null, options: { enabled?: boolean } = {}) {
  const enabled = Boolean(executionId) && (options.enabled ?? true);
  const query = useQuery<AsrExecutionDetail, Error>({
    queryKey: [...QUERY_KEY, executionId],
    queryFn: () => fetchAsrExecutionDetail(executionId!),
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

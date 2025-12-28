import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  FileStorageProviderDetailResponse,
  FileStorageProviderSummary,
  FileStorageProvidersListResponse,
} from "@/types/file-storage-providers";

const QUERY_KEY = ["admin", "file-storage", "providers"] as const;

function buildQueryString(params: { limit?: number; offset?: number } = {}) {
  const search = new URLSearchParams();
  if (typeof params.limit === "number") search.set("limit", String(params.limit));
  if (typeof params.offset === "number") search.set("offset", String(params.offset));
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function fetchFileStorageProviders(params: { limit?: number; offset?: number } = {}) {
  const query = buildQueryString(params);
  const res = await apiRequest("GET", `/api/admin/file-storage/providers${query}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Не удалось загрузить провайдеры");
  }
  return (await res.json()) as FileStorageProvidersListResponse;
}

export async function fetchFileStorageProviderDetails(providerId: string) {
  const res = await apiRequest("GET", `/api/admin/file-storage/providers/${providerId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Провайдер не найден");
  }
  return (await res.json()) as FileStorageProviderDetailResponse;
}

export async function createFileStorageProvider(payload: Partial<FileStorageProviderSummary>) {
  const res = await apiRequest("POST", "/api/admin/file-storage/providers", payload);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || "Не удалось создать провайдера";
    const error = new Error(message) as Error & { details?: unknown };
    if (body?.details) error.details = body.details;
    throw error;
  }
  return body as FileStorageProviderDetailResponse;
}

export async function updateFileStorageProvider(
  providerId: string,
  payload: Partial<FileStorageProviderSummary>,
) {
  const res = await apiRequest("PATCH", `/api/admin/file-storage/providers/${providerId}`, payload);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || "Не удалось сохранить провайдера";
    const error = new Error(message) as Error & { details?: unknown };
    if (body?.details) error.details = body.details;
    throw error;
  }
  return body as FileStorageProviderDetailResponse;
}

export async function deleteFileStorageProvider(providerId: string) {
  const res = await apiRequest("DELETE", `/api/admin/file-storage/providers/${providerId}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || "Не удалось удалить провайдера";
    throw new Error(message);
  }
  return body as { success: boolean };
}

export async function updateWorkspaceDefaultFileStorageProvider(
  workspaceId: string,
  providerId: string | null,
) {
  const res = await apiRequest(
    "PUT",
    `/api/admin/workspaces/${workspaceId}/default-file-storage-provider`,
    { providerId },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || "Не удалось сохранить провайдера по умолчанию";
    const error = new Error(message) as Error & { details?: unknown };
    if (body?.details) error.details = body.details;
    throw error;
  }
  return body as { provider: FileStorageProviderSummary | null };
}

export function useFileStorageProvidersList(params: { limit?: number; offset?: number } = {}) {
  const query = useQuery<FileStorageProvidersListResponse, Error>({
    queryKey: [...QUERY_KEY, params],
    queryFn: () => fetchFileStorageProviders(params),
  });

  return {
    providers: query.data?.providers ?? [],
    total: query.data?.total ?? 0,
    limit: query.data?.limit ?? params.limit,
    offset: query.data?.offset ?? params.offset ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useFileStorageProviderDetails(providerId: string | null, options: { enabled?: boolean } = {}) {
  const enabled = Boolean(providerId) && (options.enabled ?? true);
  const query = useQuery<FileStorageProviderDetailResponse, Error>({
    queryKey: [...QUERY_KEY, "detail", providerId],
    queryFn: () => fetchFileStorageProviderDetails(providerId!),
    enabled,
  });

  return {
    provider: query.data?.provider,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  SpeechProvidersListParams,
  SpeechProvidersListResponse,
  SpeechProviderDetailResponse,
  SpeechProviderDetail,
} from "@/types/speech-providers";

const SPEECH_PROVIDERS_QUERY_KEY = ["admin", "tts-stt", "providers"] as const;

function buildQueryString(params: SpeechProvidersListParams = {}): string {
  const search = new URLSearchParams();
  if (typeof params.limit === "number") {
    search.set("limit", String(params.limit));
  }
  if (typeof params.offset === "number") {
    search.set("offset", String(params.offset));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function fetchSpeechProviders(
  params: SpeechProvidersListParams = {},
): Promise<SpeechProvidersListResponse> {
  const query = buildQueryString(params);
  const response = await apiRequest("GET", `/api/admin/tts-stt/providers${query}`);
  return (await response.json()) as SpeechProvidersListResponse;
}

export async function fetchSpeechProviderDetails(providerId: string) {
  const response = await apiRequest("GET", `/api/admin/tts-stt/providers/${providerId}`);
  return (await response.json()) as SpeechProviderDetailResponse;
}

export interface UpdateSpeechProviderPayload {
  isEnabled?: boolean;
  config?: {
    languageCode?: string;
    model?: string;
    enablePunctuation?: boolean;
    iamMode?: "auto" | "manual";
    iamToken?: string;
  };
  secrets?: {
    apiKey?: string | null;
    folderId?: string | null;
    serviceAccountKey?: string | null;
    s3AccessKeyId?: string | null;
    s3SecretAccessKey?: string | null;
    s3BucketName?: string | null;
  };
}

export async function updateSpeechProvider(providerId: string, payload: UpdateSpeechProviderPayload) {
  const response = await fetch(`/api/admin/tts-stt/providers/${providerId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const parsed = isJson && text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorMessage = parsed?.message ?? `Ошибка сохранения (код ${response.status})`;
    const error = new Error(errorMessage) as Error & { details?: unknown; status?: number };
    if (parsed?.details) {
      error.details = parsed.details;
    }
    error.status = response.status;
    throw error;
  }

  return parsed as SpeechProviderDetailResponse;
}

export async function testIamToken(providerId: string) {
  const response = await fetch(`/api/admin/tts-stt/providers/${providerId}/test-iam-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const text = await response.text();
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const parsed = isJson && text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorMessage = parsed?.message ?? `Ошибка (код ${response.status})`;
    const error = new Error(errorMessage) as Error & { details?: unknown };
    if (parsed?.details) {
      error.details = parsed.details;
    }
    throw error;
  }

  return parsed as { success: boolean; message: string; tokenPreview?: string; expiresInMinutes?: number };
}

export function useSpeechProvidersList(params: SpeechProvidersListParams = {}) {
  const query = useQuery<SpeechProvidersListResponse, Error>({
    queryKey: [...SPEECH_PROVIDERS_QUERY_KEY, params],
    queryFn: () => fetchSpeechProviders(params),
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

export function useSpeechProviderDetails(providerId: string | null, options: { enabled?: boolean } = {}) {
  const enabled = Boolean(providerId) && (options.enabled ?? true);
  const query = useQuery<SpeechProviderDetailResponse, Error>({
    queryKey: [...SPEECH_PROVIDERS_QUERY_KEY, "detail", providerId],
    queryFn: () => fetchSpeechProviderDetails(providerId!),
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

export type SpeechProviderStatus = "Disabled" | "Enabled" | "Error";

export interface SpeechProviderAdminMeta {
  id: string;
  email: string | null;
}

export interface SpeechProviderSummary {
  id: string;
  name: string;
  type: string;
  direction: string;
  status: SpeechProviderStatus;
  isEnabled: boolean;
  lastUpdatedAt: string;
  lastStatusChangedAt: string | null;
  updatedByAdmin: SpeechProviderAdminMeta | null;
}

export interface SpeechProvidersListResponse {
  providers: SpeechProviderSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface SpeechProviderDetail extends SpeechProviderSummary {
  lastValidationAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  config: Record<string, unknown>;
  secrets: Record<string, { isSet: boolean }>;
}

export interface SpeechProviderDetailResponse {
  provider: SpeechProviderDetail;
}

export interface SpeechProvidersListParams {
  limit?: number;
  offset?: number;
}

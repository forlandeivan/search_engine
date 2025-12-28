export type FileStorageAuthType = "none" | "bearer";

export interface FileStorageProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  description?: string | null;
  authType: FileStorageAuthType;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FileStorageProvidersListResponse {
  providers: FileStorageProviderSummary[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface FileStorageProviderDetailResponse {
  provider: FileStorageProviderSummary;
}

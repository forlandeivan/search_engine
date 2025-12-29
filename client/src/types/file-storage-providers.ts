export type FileStorageAuthType = "none" | "bearer";

export interface FileStorageProviderConfig {
  uploadMethod: "POST" | "PUT";
  pathTemplate: string;
  multipartFieldName: string;
  metadataFieldName: string | null;
  responseFileIdPath: string;
  defaultTimeoutMs?: number | null;
}

export interface FileStorageProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  description?: string | null;
  authType: FileStorageAuthType;
  isActive: boolean;
  config?: FileStorageProviderConfig;
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

export interface WorkspaceFileStorageProvidersResponse {
  providers: FileStorageProviderSummary[];
  workspaceDefaultProvider: FileStorageProviderSummary | null;
}

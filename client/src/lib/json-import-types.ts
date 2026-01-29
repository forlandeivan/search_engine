// Re-export types from shared/json-import for client use
// This file helps with type imports in client components

import type { FieldInfo } from "@shared/json-import";

export type FileFormat = "json_array" | "jsonl";

// Re-export FieldInfo from shared
export type { FieldInfo };

export interface StructureAnalysis {
  format: FileFormat;
  estimatedRecordCount: number;
  fileSize: number;
  fields: FieldInfo[];
  sampleRecords: Array<Record<string, unknown>>;
  warnings: Array<{
    code: string;
    message: string;
  }>;
}

export interface PreviewError {
  error: string;
  code: "INVALID_FORMAT" | "EMPTY_FILE" | "PARSE_ERROR" | "FILE_NOT_FOUND";
  details?: string;
}

// Re-export types from shared/json-import for client use
// This file helps with type imports in client components

export type FileFormat = "json_array" | "jsonl";

export interface FieldInfo {
  key: string;
  path: string; // для вложенных: "metadata.author"
  type: "string" | "number" | "boolean" | "array" | "object" | "null" | "mixed";
  frequency: number; // процент записей с этим полем (0-100)
  sampleValues: string[]; // примеры значений (до 3)
}

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

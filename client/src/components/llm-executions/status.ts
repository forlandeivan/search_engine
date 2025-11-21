import type { LlmExecutionStatus } from "@/types/llm-execution";

export const EXECUTION_STATUS_COLORS: Record<LlmExecutionStatus, string> = {
  success: "bg-green-100 text-green-900",
  error: "bg-red-100 text-red-900",
  cancelled: "bg-gray-100 text-gray-900",
  timeout: "bg-yellow-100 text-yellow-900",
  running: "bg-blue-100 text-blue-900",
  pending: "bg-muted text-muted-foreground",
};

export const EXECUTION_STATUS_LABELS: Record<LlmExecutionStatus, string> = {
  pending: "Ожидание",
  running: "Выполняется",
  success: "Успешно",
  error: "Ошибка",
  timeout: "Таймаут",
  cancelled: "Отменено",
};

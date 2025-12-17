import { ApiError } from "@/lib/queryClient";

type InsufficientCreditsDetails = {
  availableCredits?: number;
  requiredCredits?: number;
  modelId?: string;
  modelKey?: string;
  modelName?: string;
  unit?: string;
  estimatedUnits?: number;
};

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isInsufficientCreditsError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "INSUFFICIENT_CREDITS";
}

export function formatApiErrorMessage(error: unknown): string {
  if (isInsufficientCreditsError(error)) {
    const details = (error.details ?? {}) as InsufficientCreditsDetails;
    const available = typeof details.availableCredits === "number" ? details.availableCredits : null;
    const required = typeof details.requiredCredits === "number" ? details.requiredCredits : null;
    const model =
      typeof details.modelName === "string" && details.modelName.trim()
        ? details.modelName.trim()
        : typeof details.modelKey === "string" && details.modelKey.trim()
          ? details.modelKey.trim()
          : typeof details.modelId === "string" && details.modelId.trim()
            ? details.modelId.trim()
            : null;

    const parts: string[] = ["Недостаточно кредитов для операции."];
    const budgetParts: string[] = [];
    if (available !== null) {
      budgetParts.push(`доступно ${available}`);
    }
    if (required !== null) {
      budgetParts.push(`нужно ${required}`);
    }
    if (budgetParts.length > 0) {
      parts.push(budgetParts.join(", "));
    }
    if (model) {
      parts.push(`Модель: ${model}`);
    }
    return parts.join(" ").trim();
  }

  if (isApiError(error) && error.message) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Неизвестная ошибка";
}

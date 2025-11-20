import type { LlmModelOption } from "@shared/schema";

export function sanitizeLlmModelOptions(models: unknown): LlmModelOption[] {
  if (!Array.isArray(models)) {
    return [];
  }

  const sanitized: LlmModelOption[] = [];

  for (const entry of models) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const value = typeof raw.value === "string" ? raw.value.trim() : "";

    if (label.length === 0 || value.length === 0) {
      continue;
    }

    sanitized.push({ label, value });
  }

  return sanitized;
}

import { useState, useCallback } from "react";
import type { MappingExpression } from "@shared/json-import";

interface TestExpressionResponse {
  success: boolean;
  result?: string;
  error?: string;
  duration?: number;
}

interface UseLlmTestGenerationOptions {
  workspaceId: string;
}

export function useLlmTestGeneration({ workspaceId }: UseLlmTestGenerationOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const generate = useCallback(async (
    prompt: MappingExpression,
    sampleRecord: Record<string, unknown>,
    temperature?: number
  ) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/llm/test-expression", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": workspaceId,
        },
        credentials: "include",
        body: JSON.stringify({
          workspaceId,
          prompt,
          sampleRecord,
          temperature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json() as TestExpressionResponse;

      if (data.success && data.result) {
        setResult(data.result);
        return data.result;
      } else {
        setError(data.error || "Ошибка генерации");
        return null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка запроса";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return {
    generate,
    reset,
    isLoading,
    error,
    result,
  };
}

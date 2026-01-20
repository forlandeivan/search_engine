import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
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
      const response = await apiRequest<TestExpressionResponse>(
        "/api/llm/test-expression",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            prompt,
            sampleRecord,
            temperature,
          }),
        }
      );

      if (response.success && response.result) {
        setResult(response.result);
        return response.result;
      } else {
        setError(response.error || "Ошибка генерации");
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

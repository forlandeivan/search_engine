/**
 * Utilities for vector operations in VectorCollectionDetailPage
 */

import type { PublicEmbeddingProvider } from "@shared/schema";

export function parseVectorInput(raw: string): number[] {
  const tokens = raw
    .split(/[\s,]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("Введите значения вектора через пробел или запятую.");
  }

  const vector: number[] = [];

  for (const token of tokens) {
    const parsed = Number(token);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Некорректное значение вектора: "${token}".`);
    }
    vector.push(parsed);
  }

  return vector;
}

export function formatVectorPreview(vector: number[]): string {
  if (vector.length === 0) {
    return "—";
  }

  const preview = vector.slice(0, 6).map((value) => value.toFixed(3)).join(", ");
  return vector.length > 6 ? `${preview}, …` : preview;
}

export function resolveProviderVectorSize(provider: PublicEmbeddingProvider | undefined): number | null {
  if (!provider) {
    return null;
  }

  const candidate = provider.qdrantConfig?.vectorSize;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

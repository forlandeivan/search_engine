/**
 * Utilities for search operations in VectorCollectionDetailPage
 */

export function clampTopK(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const rounded = Math.round(value);
  return Math.min(100, Math.max(1, rounded));
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU").format(value);
}

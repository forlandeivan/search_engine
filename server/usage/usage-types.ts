// Canonical usage metric keys for workspace aggregates (calendar-month scope).
export const WORKSPACE_USAGE_METRICS = [
  "llm_tokens_total",
  "embeddings_tokens_total",
  "asr_minutes_total",
  "storage_bytes_total",
  "skills_count",
  "knowledge_bases_count",
  "members_count",
] as const;

export type WorkspaceUsageMetric = (typeof WORKSPACE_USAGE_METRICS)[number];

// Period is a shared calendar month; `periodCode` should follow YYYY-MM.
// Alternative would be a `billing_periods` table, but inline fields keep the aggregate unique index simple.
export type UsagePeriod = {
  periodYear: number;
  periodMonth: number;
  periodCode: string;
};

export function formatUsagePeriodCode(year: number, month: number): string {
  const paddedMonth = String(month).padStart(2, "0");
  return `${year}-${paddedMonth}`;
}

export function getUsagePeriodForDate(date: Date = new Date()): UsagePeriod {
  const periodYear = date.getUTCFullYear();
  const periodMonth = date.getUTCMonth() + 1;
  return {
    periodYear,
    periodMonth,
    periodCode: formatUsagePeriodCode(periodYear, periodMonth),
  };
}

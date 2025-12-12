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

export function parseUsagePeriodCode(code: string): UsagePeriod | null {
  if (!code || typeof code !== "string") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(code.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 1970 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    periodYear: year,
    periodMonth: month,
    periodCode: formatUsagePeriodCode(year, month),
  };
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

export function getUsagePeriodBounds(period: UsagePeriod): { start: Date; end: Date } {
  const start = new Date(Date.UTC(period.periodYear, period.periodMonth - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(period.periodYear, period.periodMonth, 1, 0, 0, 0, 0));
  return { start, end };
}

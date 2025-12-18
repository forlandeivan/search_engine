export const CREDITS_SCALE = 100 as const;

type ParseResult = { ok: true; cents: number } | { ok: false };

function parseDecimalToCents(raw: string): ParseResult {
  const normalized = raw.trim().replace(",", ".");
  if (normalized.length === 0) {
    return { ok: true, cents: 0 };
  }

  const match = normalized.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return { ok: false };
  }

  const sign = match[1] === "-" ? -1 : 1;
  const wholePartRaw = match[2];
  const fractionRaw = match[3] ?? "";

  const whole = Number(wholePartRaw);
  if (!Number.isSafeInteger(whole)) {
    return { ok: false };
  }

  const fraction2 = fractionRaw.padEnd(2, "0").slice(0, 2);
  const fractionValue = Number(fraction2);
  if (!Number.isSafeInteger(fractionValue)) {
    return { ok: false };
  }

  let cents = whole * CREDITS_SCALE + fractionValue;
  const extra = fractionRaw.slice(2);
  if (extra.length > 0 && extra[0] >= "5") {
    cents += 1; // round half-up to 2 decimals
  }

  const signed = sign * cents;
  if (!Number.isSafeInteger(signed)) {
    return { ok: false };
  }

  return { ok: true, cents: signed };
}

export function tryParseCreditsToCents(value: unknown): number | null {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const parsed = parseDecimalToCents(String(value));
    return parsed.ok ? parsed.cents : null;
  }

  if (typeof value === "string") {
    const parsed = parseDecimalToCents(value);
    return parsed.ok ? parsed.cents : null;
  }

  return null;
}

export function parseCreditsToCents(value: unknown, opts?: { allowNegative?: boolean }): number {
  const cents = tryParseCreditsToCents(value);
  if (cents === null) {
    throw new Error("invalid_credits_value");
  }
  if (!opts?.allowNegative && cents < 0) {
    throw new Error("credits_must_be_non_negative");
  }
  return cents;
}

export function centsToCredits(cents: number | null | undefined): number {
  const value = Number(cents ?? 0);
  if (!Number.isFinite(value)) return 0;
  return value / CREDITS_SCALE;
}

export function formatCredits(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

export function formatCreditsFromCents(cents: number | null | undefined): string {
  return formatCredits(centsToCredits(cents));
}

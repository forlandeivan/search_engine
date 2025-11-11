export type PgError = Error & { code?: string };

export function isPgError(error: unknown): error is PgError {
  return typeof error === "object" && error !== null && "message" in error;
}

export function swallowPgError(error: unknown, allowedCodes: string[]): void {
  if (!isPgError(error)) {
    throw error;
  }

  const code = (error as PgError).code;
  if (!code || !allowedCodes.includes(code)) {
    throw error;
  }
}

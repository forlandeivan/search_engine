/**
 * Error types for better type safety
 * 
 * Phase 6.1: Устранение any типов
 */

/**
 * HTTP error with status code
 */
export interface HttpErrorLike {
  status?: number;
  statusCode?: number;
  code?: string;
  message: string;
  response?: {
    status?: number;
    statusCode?: number;
  };
}

/**
 * Node.js error with code
 */
export interface NodeErrorLike {
  code?: string;
  syscall?: string;
  errno?: number;
}

/**
 * Qdrant API error
 */
export interface QdrantApiError {
  status?: number;
  code?: string;
  message: string;
  response?: {
    status?: number;
  };
}

/**
 * Extract HTTP status from error
 */
export function getHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const err = error as HttpErrorLike;
    return err.status ?? err.statusCode ?? err.response?.status ?? err.response?.statusCode ?? null;
  }
  return null;
}

/**
 * Extract error code from error
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const err = error as HttpErrorLike & NodeErrorLike;
    return err.code;
  }
  return undefined;
}

/**
 * Extract syscall from error
 */
export function getSyscall(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const err = error as NodeErrorLike;
    return err.syscall;
  }
  return undefined;
}

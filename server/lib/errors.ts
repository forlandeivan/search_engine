/**
 * Common Error Classes
 * 
 * Shared error classes for use across the application.
 */

/**
 * HTTP Error with status code
 */
export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

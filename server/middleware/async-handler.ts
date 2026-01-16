import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Async handler wrapper that catches errors in async route handlers
 * and passes them to the Express error handling middleware.
 */
export const asyncHandler = <T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
};

export default asyncHandler;

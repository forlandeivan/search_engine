/**
 * Prometheus Metrics Middleware
 * 
 * Express middleware for collecting HTTP request metrics.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  httpRequestDuration,
  httpRequestsTotal,
  httpActiveConnections,
} from './metrics';

/**
 * Normalize route path for consistent metric labels.
 * Replaces dynamic parameters with placeholders.
 */
function normalizeRoute(path: string): string {
  if (!path) return 'unknown';
  
  // Replace UUID-like patterns
  let normalized = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id'
  );
  
  // Replace numeric IDs
  normalized = normalized.replace(/\/\d+/g, '/:id');
  
  // Replace other alphanumeric IDs (but preserve route segments)
  normalized = normalized.replace(/\/[0-9a-f]{24,}/gi, '/:id');
  
  // Limit length to avoid high cardinality
  if (normalized.length > 100) {
    normalized = normalized.substring(0, 100) + '...';
  }
  
  return normalized;
}

/**
 * Middleware that collects HTTP request metrics.
 * Should be added early in the middleware chain.
 */
export const metricsMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Skip metrics endpoint itself to avoid self-referencing
  if (req.path === '/metrics' || req.path === '/api/metrics') {
    next();
    return;
  }

  // Track active connections
  httpActiveConnections.inc();

  // Record start time
  const startTime = process.hrtime.bigint();

  // Handle response finish
  const onFinish = () => {
    // Calculate duration in seconds
    const endTime = process.hrtime.bigint();
    const durationNs = Number(endTime - startTime);
    const durationSec = durationNs / 1e9;

    // Get route path (prefer Express route over raw path for better grouping)
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : normalizeRoute(req.path);

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    // Record metrics
    httpRequestDuration.observe(labels, durationSec);
    httpRequestsTotal.inc(labels);

    // Decrement active connections
    httpActiveConnections.dec();

    // Clean up listeners
    res.removeListener('finish', onFinish);
    res.removeListener('close', onClose);
  };

  const onClose = () => {
    httpActiveConnections.dec();
    res.removeListener('finish', onFinish);
    res.removeListener('close', onClose);
  };

  res.on('finish', onFinish);
  res.on('close', onClose);

  next();
};

/**
 * Creates a timer for measuring operation duration.
 * Returns a function to call when the operation completes.
 */
export function startTimer() {
  const startTime = process.hrtime.bigint();
  return (): number => {
    const endTime = process.hrtime.bigint();
    const durationNs = Number(endTime - startTime);
    return durationNs / 1e9;
  };
}

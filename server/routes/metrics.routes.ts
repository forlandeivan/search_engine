/**
 * Prometheus Metrics Route
 * 
 * Exposes application metrics in Prometheus format at /metrics endpoint.
 */

import { Router } from 'express';
import { register } from '../monitoring/metrics';

const metricsRouter = Router();

/**
 * GET /metrics
 * Returns application metrics in Prometheus text format
 */
metricsRouter.get('/', async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (error) {
    console.error('[metrics] Failed to collect metrics:', error);
    res.status(500).send('Error collecting metrics');
  }
});

export { metricsRouter };

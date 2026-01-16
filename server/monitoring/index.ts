/**
 * Monitoring Module
 * 
 * Exports Prometheus metrics and middleware for application monitoring.
 * 
 * Usage:
 * 1. Add middleware to Express app:
 *    app.use(metricsMiddleware);
 * 
 * 2. Add metrics endpoint:
 *    app.get('/metrics', async (req, res) => {
 *      res.set('Content-Type', register.contentType);
 *      res.send(await register.metrics());
 *    });
 * 
 * 3. Use metrics in your code:
 *    llmRequestDuration.observe({ provider: 'gigachat', model: 'pro', status: 'success' }, 2.5);
 */

export * from './metrics';
export * from './middleware';

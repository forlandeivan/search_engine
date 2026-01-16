/**
 * OpenAPI Documentation Routes
 * 
 * Serves OpenAPI spec and Swagger UI for API documentation.
 */

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { getOpenAPISpec } from '../openapi';

const openapiRouter = Router();

// Swagger UI options
const swaggerOptions: swaggerUi.SwaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
  },
};

/**
 * GET /api/docs/json
 * Returns OpenAPI spec as JSON
 */
openapiRouter.get('/json', (_req, res) => {
  try {
    const spec = getOpenAPISpec();
    res.json(spec);
  } catch (error) {
    console.error('[openapi] Failed to generate spec:', error);
    res.status(500).json({ message: 'Failed to generate OpenAPI spec' });
  }
});

/**
 * GET /api/docs
 * Serves Swagger UI
 */
openapiRouter.use('/', swaggerUi.serve);
openapiRouter.get('/', (_req, res, next) => {
  try {
    const spec = getOpenAPISpec();
    swaggerUi.setup(spec, swaggerOptions)(_req, res, next);
  } catch (error) {
    console.error('[openapi] Failed to setup Swagger UI:', error);
    res.status(500).send('Failed to load API documentation');
  }
});

export { openapiRouter };

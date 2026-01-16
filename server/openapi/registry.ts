/**
 * OpenAPI Registry
 * 
 * Central registry for OpenAPI schema definitions.
 * Uses @asteasolutions/zod-to-openapi to generate OpenAPI spec from Zod schemas.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI methods
extendZodWithOpenApi(z);

// Create the registry
export const registry = new OpenAPIRegistry();

// API version info
const API_INFO = {
  title: 'LTG Platform API',
  version: '1.0.0',
  description: `
    API для платформы LTG (Language Technology Gateway).
    
    ## Аутентификация
    
    Большинство endpoints требуют аутентификации через сессионные cookies или Bearer token.
    
    ## Версионирование
    
    API использует семантическое версионирование. Все endpoints имеют префикс /api/.
  `,
  contact: {
    name: 'LTG Platform Team',
  },
  license: {
    name: 'Proprietary',
  },
};

// Server configuration
const SERVERS = [
  {
    url: 'http://localhost:5000',
    description: 'Development server',
  },
  {
    url: '{protocol}://{host}',
    description: 'Custom server',
    variables: {
      protocol: {
        default: 'https',
        enum: ['http', 'https'],
      },
      host: {
        default: 'localhost:5000',
      },
    },
  },
];

// Security schemes
registry.registerComponent('securitySchemes', 'sessionAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'connect.sid',
  description: 'Session cookie authentication',
});

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Bearer token authentication',
});

// Common response schemas
const errorResponseSchema = z.object({
  message: z.string().openapi({ description: 'Error message' }),
  code: z.string().optional().openapi({ description: 'Error code' }),
  details: z.any().optional().openapi({ description: 'Additional error details' }),
}).openapi('ErrorResponse');

const successResponseSchema = z.object({
  success: z.boolean().openapi({ description: 'Operation success status' }),
}).openapi('SuccessResponse');

registry.register('ErrorResponse', errorResponseSchema);
registry.register('SuccessResponse', successResponseSchema);

/**
 * Generate OpenAPI document
 */
export function generateOpenAPIDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  
  return generator.generateDocument({
    info: API_INFO,
    servers: SERVERS,
    openapi: '3.0.3',
  });
}

/**
 * Get OpenAPI spec as JSON
 */
export function getOpenAPISpec() {
  return generateOpenAPIDocument();
}

export { z };

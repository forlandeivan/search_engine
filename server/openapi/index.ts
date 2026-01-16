/**
 * OpenAPI Module
 * 
 * Provides OpenAPI documentation generation from Zod schemas.
 * 
 * Usage:
 * 1. Import schemas from ./schemas to register them
 * 2. Use getOpenAPISpec() to get the generated OpenAPI document
 */

// Import schemas to register them
import './schemas/auth';

// Export registry and generator
export { registry, getOpenAPISpec, generateOpenAPIDocument, z } from './registry';

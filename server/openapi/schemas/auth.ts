/**
 * OpenAPI schemas for Auth endpoints
 */

import { registry, z } from '../registry';

// ============================================================================
// Request/Response Schemas
// ============================================================================

const authProvidersResponseSchema = z.object({
  providers: z.array(z.object({
    name: z.string().openapi({ description: 'Provider identifier', example: 'google' }),
    enabled: z.boolean().openapi({ description: 'Whether provider is enabled' }),
  })),
  localEnabled: z.boolean().openapi({ description: 'Whether local auth is enabled' }),
}).openapi('AuthProvidersResponse');

const loginRequestSchema = z.object({
  email: z.string().email().openapi({ description: 'User email', example: 'user@example.com' }),
  password: z.string().min(1).openapi({ description: 'User password' }),
}).openapi('LoginRequest');

const loginResponseSchema = z.object({
  user: z.object({
    id: z.string().openapi({ description: 'User ID' }),
    email: z.string().email().openapi({ description: 'User email' }),
    displayName: z.string().nullable().openapi({ description: 'Display name' }),
    role: z.enum(['user', 'admin']).openapi({ description: 'User role' }),
  }),
}).openapi('LoginResponse');

const registerRequestSchema = z.object({
  email: z.string().email().openapi({ description: 'User email' }),
  password: z.string().min(8).openapi({ description: 'Password (min 8 characters)' }),
  displayName: z.string().optional().openapi({ description: 'Display name' }),
}).openapi('RegisterRequest');

const sessionResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    displayName: z.string().nullable(),
    role: z.enum(['user', 'admin']),
  }).nullable(),
  isAuthenticated: z.boolean(),
}).openapi('SessionResponse');

// ============================================================================
// Register schemas
// ============================================================================

registry.register('AuthProvidersResponse', authProvidersResponseSchema);
registry.register('LoginRequest', loginRequestSchema);
registry.register('LoginResponse', loginResponseSchema);
registry.register('RegisterRequest', registerRequestSchema);
registry.register('SessionResponse', sessionResponseSchema);

// ============================================================================
// Register endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/auth/providers',
  summary: 'Get available auth providers',
  description: 'Returns list of available authentication providers and their status',
  tags: ['Authentication'],
  responses: {
    200: {
      description: 'List of auth providers',
      content: {
        'application/json': {
          schema: authProvidersResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Login with email/password',
  description: 'Authenticate user with email and password',
  tags: ['Authentication'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: loginResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid credentials',
      content: {
        'application/json': {
          schema: z.object({ message: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  summary: 'Register new user',
  description: 'Create a new user account',
  tags: ['Authentication'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Registration successful',
      content: {
        'application/json': {
          schema: loginResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': {
          schema: z.object({ message: z.string() }),
        },
      },
    },
    409: {
      description: 'Email already exists',
      content: {
        'application/json': {
          schema: z.object({ message: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/session',
  summary: 'Get current session',
  description: 'Returns current user session info',
  tags: ['Authentication'],
  security: [{ sessionAuth: [] }],
  responses: {
    200: {
      description: 'Session info',
      content: {
        'application/json': {
          schema: sessionResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  summary: 'Logout',
  description: 'End current user session',
  tags: ['Authentication'],
  security: [{ sessionAuth: [] }],
  responses: {
    200: {
      description: 'Logout successful',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
  },
});

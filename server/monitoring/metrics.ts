/**
 * Prometheus Metrics Module
 * 
 * Provides application-wide metrics for monitoring performance,
 * request patterns, and system health.
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const register = new Registry();

// Add default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register });

// ============================================================================
// HTTP Request Metrics
// ============================================================================

/**
 * Duration of HTTP requests in seconds
 */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Total number of HTTP requests
 */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

/**
 * Currently active HTTP connections
 */
export const httpActiveConnections = new Gauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

// ============================================================================
// Database Metrics
// ============================================================================

/**
 * Database query duration in seconds
 */
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

/**
 * Total number of database queries
 */
export const dbQueriesTotal = new Counter({
  name: 'db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'table', 'status'] as const,
  registers: [register],
});

/**
 * Active database pool connections
 */
export const dbPoolConnections = new Gauge({
  name: 'db_pool_connections',
  help: 'Number of connections in the database pool',
  labelNames: ['state'] as const,
  registers: [register],
});

// ============================================================================
// LLM Metrics
// ============================================================================

/**
 * LLM request duration in seconds
 */
export const llmRequestDuration = new Histogram({
  name: 'llm_request_duration_seconds',
  help: 'Duration of LLM API requests in seconds',
  labelNames: ['provider', 'model', 'status'] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [register],
});

/**
 * Total LLM tokens processed
 */
export const llmTokensTotal = new Counter({
  name: 'llm_tokens_total',
  help: 'Total number of LLM tokens processed',
  labelNames: ['provider', 'model', 'type'] as const, // type: input|output
  registers: [register],
});

/**
 * Total LLM requests
 */
export const llmRequestsTotal = new Counter({
  name: 'llm_requests_total',
  help: 'Total number of LLM requests',
  labelNames: ['provider', 'model', 'status'] as const,
  registers: [register],
});

// ============================================================================
// Embedding Metrics
// ============================================================================

/**
 * Embedding request duration in seconds
 */
export const embeddingRequestDuration = new Histogram({
  name: 'embedding_request_duration_seconds',
  help: 'Duration of embedding API requests in seconds',
  labelNames: ['provider', 'status'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * Total embedding requests
 */
export const embeddingRequestsTotal = new Counter({
  name: 'embedding_requests_total',
  help: 'Total number of embedding requests',
  labelNames: ['provider', 'status'] as const,
  registers: [register],
});

// ============================================================================
// Vector Store (Qdrant) Metrics
// ============================================================================

/**
 * Vector search duration in seconds
 */
export const vectorSearchDuration = new Histogram({
  name: 'vector_search_duration_seconds',
  help: 'Duration of vector search operations in seconds',
  labelNames: ['collection', 'type'] as const, // type: search|upsert|delete
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

/**
 * Total vector operations
 */
export const vectorOperationsTotal = new Counter({
  name: 'vector_operations_total',
  help: 'Total number of vector store operations',
  labelNames: ['collection', 'type', 'status'] as const,
  registers: [register],
});

// ============================================================================
// Knowledge Base Metrics
// ============================================================================

/**
 * Knowledge base indexing jobs
 */
export const indexingJobsTotal = new Counter({
  name: 'kb_indexing_jobs_total',
  help: 'Total number of knowledge base indexing jobs',
  labelNames: ['status'] as const, // status: started|completed|failed
  registers: [register],
});

/**
 * Documents indexed per knowledge base
 */
export const documentsIndexed = new Gauge({
  name: 'kb_documents_indexed',
  help: 'Number of documents indexed in knowledge bases',
  labelNames: ['knowledge_base_id'] as const,
  registers: [register],
});

// ============================================================================
// Chat Metrics
// ============================================================================

/**
 * Total chat messages
 */
export const chatMessagesTotal = new Counter({
  name: 'chat_messages_total',
  help: 'Total number of chat messages',
  labelNames: ['role', 'workspace_id'] as const,
  registers: [register],
});

/**
 * Active chat sessions
 */
export const activeChatSessions = new Gauge({
  name: 'chat_active_sessions',
  help: 'Number of active chat sessions',
  registers: [register],
});

// ============================================================================
// Authentication Metrics
// ============================================================================

/**
 * Authentication attempts
 */
export const authAttemptsTotal = new Counter({
  name: 'auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['method', 'status'] as const, // method: local|google|yandex, status: success|failure
  registers: [register],
});

// ============================================================================
// WebSocket Metrics
// ============================================================================

/**
 * Active WebSocket connections
 */
export const wsActiveConnections = new Gauge({
  name: 'ws_active_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

/**
 * Total WebSocket messages
 */
export const wsMessagesTotal = new Counter({
  name: 'ws_messages_total',
  help: 'Total number of WebSocket messages',
  labelNames: ['type', 'direction'] as const, // direction: in|out
  registers: [register],
});

// ============================================================================
// Error Metrics
// ============================================================================

/**
 * Application errors
 */
export const errorsTotal = new Counter({
  name: 'app_errors_total',
  help: 'Total number of application errors',
  labelNames: ['type', 'module'] as const,
  registers: [register],
});

// ============================================================================
// Business Metrics
// ============================================================================

/**
 * Credits consumed
 */
export const creditsConsumed = new Counter({
  name: 'credits_consumed_total',
  help: 'Total credits consumed',
  labelNames: ['workspace_id', 'operation_type'] as const,
  registers: [register],
});

/**
 * Active workspaces
 */
export const activeWorkspaces = new Gauge({
  name: 'active_workspaces',
  help: 'Number of active workspaces',
  registers: [register],
});

/**
 * Active users
 */
export const activeUsers = new Gauge({
  name: 'active_users',
  help: 'Number of active users',
  registers: [register],
});

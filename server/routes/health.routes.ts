/**
 * Health Check Routes Module
 * 
 * Handles system health check endpoints:
 * - GET /api/health/vector - Qdrant health check
 * - GET /api/health/db - Database health check
 */

import { Router } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { getQdrantClient } from '../qdrant';
import { getPubSubHealth } from '../realtime';
import { getChatSubscriptionStats as getChatStats } from '../chat-events';

const logger = createLogger('health');

export const healthRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function maskSensitiveInfoInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    if (parsed.username) {
      parsed.username = parsed.username.substring(0, 2) + '***';
    }
    return parsed.toString();
  } catch {
    return url.replace(/:[^:]*@/, ':***@');
  }
}

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

interface QdrantApiError {
  message: string;
  details?: unknown;
}

function extractQdrantApiError(error: unknown): QdrantApiError | null {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') {
      return {
        message: err.message,
        details: err.details ?? null,
      };
    }
  }
  return null;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /vector
 * Qdrant health check
 */
healthRouter.get('/vector', async (_req, res) => {
  const qdrantUrl = process.env.QDRANT_URL || null;
  const maskedUrl = qdrantUrl ? maskSensitiveInfoInUrl(qdrantUrl) : null;
  const apiKeyConfigured = Boolean(process.env.QDRANT_API_KEY && process.env.QDRANT_API_KEY.trim());
  
  const basePayload = {
    status: 'unknown' as const,
    configured: Boolean(qdrantUrl),
    connected: false,
    url: maskedUrl,
    apiKeyConfigured,
    collectionsCount: null as number | null,
    latencyMs: null as number | null,
    timestamp: new Date().toISOString(),
  };

  if (!qdrantUrl) {
    logger.warn('QDRANT_URL не задан — Qdrant считается не настроенным');
    return res.json({
      ...basePayload,
      status: 'not_configured' as const,
      error: 'Переменная окружения QDRANT_URL не задана',
    });
  }

  try {
    const startedAt = performance.now();
    const client = getQdrantClient();
    const collectionsResponse = await client.getCollections();
    const latencyMs = Math.round(performance.now() - startedAt);
    const collections =
      collectionsResponse && typeof collectionsResponse === 'object'
        ? (collectionsResponse as { collections?: unknown }).collections
        : undefined;
    const collectionsCount = Array.isArray(collections) ? collections.length : null;

    return res.json({
      ...basePayload,
      status: 'ok' as const,
      connected: true,
      latencyMs,
      collectionsCount,
    });
  } catch (error) {
    const qdrantError = extractQdrantApiError(error);
    const errorMessage = qdrantError?.message ?? getErrorDetails(error);
    const errorDetails = qdrantError?.details ?? null;
    const errorName = error instanceof Error ? error.name : undefined;
    const errorCode = getNodeErrorCode(error);

    logger.error({ error, url: maskedUrl, errorName, errorCode }, 'Ошибка проверки подключения к Qdrant');

    return res.json({
      ...basePayload,
      status: 'error' as const,
      error: errorMessage,
      errorDetails,
      errorName,
      errorCode,
    });
  }
});

/**
 * GET /pubsub
 * PubSub health check for multi-instance scaling
 */
healthRouter.get('/pubsub', async (_req, res) => {
  try {
    const pubsubHealth = await getPubSubHealth();
    const chatStats = getChatStats();
    
    return res.json({
      status: pubsubHealth.healthy ? 'ok' : 'degraded',
      provider: pubsubHealth.provider,
      healthy: pubsubHealth.healthy,
      stats: pubsubHealth.stats,
      chatSubscriptions: chatStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'PubSub health check failed');
    return res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /db
 * Database health check
 */
healthRouter.get('/db', async (_req, res) => {
  try {
    logger.info('Database health check requested');
    
    const dbUrl = process.env.DATABASE_URL || 'not_set';
    const maskedUrl = dbUrl.replace(/:[^:]*@/, ':***@');
    
    const dbInfo = await storage.getDatabaseHealthInfo();
    
    const healthInfo = {
      database: {
        url_masked: maskedUrl,
        connected: true,
        ...dbInfo,
      },
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
    };
    
    logger.info({ healthInfo }, 'Database health check completed');
    res.json(healthInfo);
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    res.status(500).json({ 
      error: 'Database health check failed',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

export default healthRouter;

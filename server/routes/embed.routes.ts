/**
 * Embed Keys Routes Module
 * 
 * Handles public embed keys for widget integration:
 * - POST /api/embed/keys - Create/get embed key for collection
 * - GET /api/embed/keys/:id/domains - List allowed domains
 * - POST /api/embed/keys/:id/domains - Add allowed domain
 * - DELETE /api/embed/keys/:id/domains/:domainId - Remove allowed domain
 */

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { invalidateCorsCache } from '../cors-cache';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('embed');

export const embedRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: any): PublicUser | null {
  return req.user as PublicUser | null;
}

function getAuthorizedUser(req: any, res: Response): PublicUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return null;
  }
  return user;
}

function getRequestWorkspace(req: any): { id: string } {
  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId };
}

function normalizeDomainCandidate(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }
  
  let domain = candidate.trim().toLowerCase();
  
  // Remove protocol if present
  domain = domain.replace(/^https?:\/\//, '');
  
  // Remove path if present
  domain = domain.split('/')[0];
  
  // Remove port if present
  domain = domain.split(':')[0];
  
  if (!domain || domain.length < 3) {
    return null;
  }
  
  // Basic domain validation
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
  if (!domainRegex.test(domain)) {
    return null;
  }
  
  return domain;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /keys
 * Create or get embed key for a collection and knowledge base
 */
embedRouter.post('/keys', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const collection = typeof req.body?.collection === 'string' ? req.body.collection.trim() : '';
  const knowledgeBaseId =
    typeof req.body?.knowledgeBaseId === 'string'
      ? req.body.knowledgeBaseId.trim()
      : typeof req.body?.knowledge_base_id === 'string'
        ? req.body.knowledge_base_id.trim()
        : '';

  if (!collection) {
    return res.status(400).json({ error: 'Укажите идентификатор коллекции' });
  }

  if (!knowledgeBaseId) {
    return res.status(400).json({ error: 'Укажите идентификатор базы знаний' });
  }

  const base = await storage.getKnowledgeBase(knowledgeBaseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена в текущем workspace' });
  }

  const embedKey = await storage.getOrCreateWorkspaceEmbedKey(workspaceId, collection, knowledgeBaseId);
  const domains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id, workspaceId);

  res.json({ key: embedKey, domains });
}));

/**
 * GET /keys/:id/domains
 * List allowed domains for embed key
 */
embedRouter.get('/keys/:id/domains', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const embedKey = await storage.getWorkspaceEmbedKey(req.params.id, workspaceId);

  if (!embedKey) {
    return res.status(404).json({ error: 'Публичный ключ не найден' });
  }

  const domains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id, workspaceId);
  res.json({ key: embedKey, domains });
}));

/**
 * POST /keys/:id/domains
 * Add allowed domain for embed key
 */
embedRouter.post('/keys/:id/domains', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const embedKey = await storage.getWorkspaceEmbedKey(req.params.id, workspaceId);

  if (!embedKey) {
    return res.status(404).json({ error: 'Публичный ключ не найден' });
  }

  const domainCandidate =
    typeof req.body?.domain === 'string'
      ? req.body.domain
      : typeof req.body?.hostname === 'string'
        ? req.body.hostname
        : '';

  const normalized = normalizeDomainCandidate(domainCandidate);
  if (!normalized) {
    return res.status(400).json({ error: 'Укажите корректное доменное имя' });
  }

  const domainEntry = await storage.addWorkspaceEmbedKeyDomain(embedKey.id, workspaceId, normalized);
  if (!domainEntry) {
    return res.status(500).json({ error: 'Не удалось добавить домен' });
  }

  invalidateCorsCache();
  res.status(201).json(domainEntry);
}));

/**
 * DELETE /keys/:id/domains/:domainId
 * Remove allowed domain from embed key
 */
embedRouter.delete('/keys/:id/domains/:domainId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const embedKey = await storage.getWorkspaceEmbedKey(req.params.id, workspaceId);

  if (!embedKey) {
    return res.status(404).json({ error: 'Публичный ключ не найден' });
  }

  const removed = await storage.removeWorkspaceEmbedKeyDomain(embedKey.id, req.params.domainId, workspaceId);
  if (!removed) {
    return res.status(404).json({ error: 'Домен не найден' });
  }

  invalidateCorsCache();
  res.status(204).send();
}));

export default embedRouter;

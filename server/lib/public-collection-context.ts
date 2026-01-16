/**
 * Public Collection Context
 * 
 * Utilities for resolving public API requests (embed keys, site API keys).
 * Used by public endpoints that don't require user authentication.
 */

import type { Request, Response } from 'express';
import { storage } from '../storage';
import { ensureWorkspaceContext, WorkspaceContextError, getRequestWorkspaceMemberships } from '../auth';
import type { Site, WorkspaceEmbedKey, PublicUser } from '@shared/schema';

// ============================================================================
// Types
// ============================================================================

export interface PublicCollectionContext {
  apiKey?: string;
  workspaceId: string;
  site?: Site;
  embedKey?: WorkspaceEmbedKey;
  knowledgeBaseId?: string;
}

export type RagResponseFormat = 'text' | 'markdown' | 'html';

// ============================================================================
// Helper Functions
// ============================================================================

export function pickFirstString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

function normalizeDomainCandidate(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const withScheme = /^(https?:)?\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    return url.hostname.toLowerCase();
  } catch {
    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
    const hostname = withoutScheme.split(/[/?#]/, 1)[0]?.split(':', 1)[0]?.trim() ?? '';
    return hostname ? hostname.toLowerCase() : null;
  }
}

export function extractRequestDomain(req: Request, bodySource: Record<string, unknown>): string | null {
  const headerOrigin = Array.isArray(req.headers['x-embed-origin']) 
    ? req.headers['x-embed-origin'][0] 
    : req.headers['x-embed-origin'];
  
  const headerCandidates = [
    headerOrigin,
    req.headers.origin,
    req.headers.referer,
  ];

  for (const value of headerCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  const queryCandidates = [
    req.query.origin,
    req.query.domain,
    req.query.host,
  ];

  for (const value of queryCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  const bodyCandidates = [bodySource.origin, bodySource.domain, bodySource.host];
  for (const value of bodyCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function normalizeResponseFormat(value: unknown): RagResponseFormat | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'md' || normalized === 'markdown') {
    return 'markdown';
  }

  if (normalized === 'html') {
    return 'html';
  }

  if (normalized === 'text' || normalized === 'plain') {
    return 'text';
  }

  return null;
}

// ============================================================================
// Resolve Optional User
// ============================================================================

async function resolveOptionalUser(req: Request): Promise<PublicUser | null> {
  return req.user as PublicUser | null ?? null;
}

// ============================================================================
// Main Resolver
// ============================================================================

export async function resolvePublicCollectionRequest(
  req: Request,
  res: Response,
): Promise<PublicCollectionContext | null> {
  const bodySource: Record<string, unknown> =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? { ...(req.body as Record<string, unknown>) }
      : {};

  const headerKey = req.headers['x-api-key'];
  const apiKey = pickFirstString(
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    bodySource.apiKey,
    req.query.apiKey,
    req.query.apikey,
  );

  const paramPublicId = typeof req.params?.publicId === 'string' ? req.params.publicId : undefined;
  const publicId = pickFirstString(
    paramPublicId,
    bodySource.publicId,
    bodySource.sitePublicId,
    req.query.publicId,
    req.query.sitePublicId,
    req.query.siteId,
  );

  const workspaceIdCandidate = pickFirstString(
    bodySource.workspaceId,
    bodySource.workspace_id,
    req.query.workspaceId,
    req.query.workspace_id,
  );

  const knowledgeBaseIdCandidate = pickFirstString(
    bodySource.kbId,
    bodySource.kb_id,
    req.query.kbId,
    req.query.kb_id,
  );

  const requestDomain = extractRequestDomain(req, bodySource);

  async function ensureWorkspaceAccess(targetWorkspaceId: string): Promise<boolean> {
    const workspaceMemberships = getRequestWorkspaceMemberships(req);
    if (workspaceMemberships.length > 0) {
      const hasAccess = workspaceMemberships.some((entry) => entry.id === targetWorkspaceId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Нет доступа к рабочему пространству' });
        return false;
      }
    } else {
      const user = await resolveOptionalUser(req);
      if (user) {
        const isMember = await storage.isWorkspaceMember(targetWorkspaceId, user.id);
        if (!isMember) {
          res.status(403).json({ error: 'Нет доступа к рабочему пространству' });
          return false;
        }
      }
    }
    return true;
  }

  if (!apiKey) {
    let resolvedWorkspaceId = workspaceIdCandidate;

    if (!resolvedWorkspaceId) {
      const user = await resolveOptionalUser(req);
      if (!user) {
        res.status(401).json({ error: 'Укажите X-API-Key в заголовке или apiKey в запросе' });
        return null;
      }

      try {
        const context = await ensureWorkspaceContext(req, user);
        resolvedWorkspaceId = context.active.id;
      } catch (err) {
        if (err instanceof WorkspaceContextError) {
          res.status(err.status).json({ error: err.message });
          return null;
        }
        throw err;
      }
    }

    if (!resolvedWorkspaceId) {
      res.status(400).json({ error: 'Передайте workspace_id или X-Workspace-Id' });
      return null;
    }

    if (!(await ensureWorkspaceAccess(resolvedWorkspaceId))) {
      return null;
    }

    if (knowledgeBaseIdCandidate) {
      const base = await storage.getKnowledgeBase(knowledgeBaseIdCandidate);
      if (!base) {
        res.status(404).json({ error: 'База знаний не найдена' });
        return null;
      }

      if (base.workspaceId !== resolvedWorkspaceId) {
        res.status(403).json({ error: 'Нет доступа к базе знаний' });
        return null;
      }

      return { workspaceId: resolvedWorkspaceId, knowledgeBaseId: base.id };
    }

    return { workspaceId: resolvedWorkspaceId };
  }

  if (publicId) {
    if (!workspaceIdCandidate) {
      res.status(400).json({ error: 'Передайте workspace_id в теле запроса' });
      return null;
    }

    if (!(await ensureWorkspaceAccess(workspaceIdCandidate))) {
      return null;
    }

    const site = await storage.getSiteByPublicId(publicId);

    if (!site) {
      res.status(404).json({ error: 'Коллекция не найдена' });
      return null;
    }

    if (site.workspaceId !== workspaceIdCandidate) {
      res.status(403).json({ error: 'Нет доступа к рабочему пространству' });
      return null;
    }

    if (site.publicApiKey !== apiKey) {
      res.status(401).json({ error: 'Некорректный API-ключ' });
      return null;
    }

    return { site, apiKey, workspaceId: workspaceIdCandidate };
  }

  const site = await storage.getSiteByPublicApiKey(apiKey);

  if (site) {
    if (workspaceIdCandidate && site.workspaceId !== workspaceIdCandidate) {
      res.status(403).json({ error: 'Нет доступа к рабочему пространству' });
      return null;
    }

    if (!(await ensureWorkspaceAccess(site.workspaceId))) {
      return null;
    }

    if (site.publicApiKey !== apiKey) {
      res.status(401).json({ error: 'Некорректный API-ключ' });
      return null;
    }

    return { site, apiKey, workspaceId: site.workspaceId };
  }

  const embedKey = await storage.getWorkspaceEmbedKeyByPublicKey(apiKey);

  if (!embedKey) {
    res.status(404).json({ error: 'Коллекция не найдена' });
    return null;
  }

  if (workspaceIdCandidate && workspaceIdCandidate !== embedKey.workspaceId) {
    res.status(403).json({ error: 'Нет доступа к рабочему пространству' });
    return null;
  }

  if (!(await ensureWorkspaceAccess(embedKey.workspaceId))) {
    return null;
  }

  const allowedDomains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id);
  const allowedDomainSet = new Set(
    allowedDomains
      .map((entry: { domain?: string }) => typeof entry.domain === 'string' ? entry.domain.trim().toLowerCase() : '')
      .filter((domain: string) => domain.length > 0),
  );

  if (allowedDomainSet.size > 0) {
    if (!requestDomain) {
      res.status(403).json({ error: 'Домен запроса не определён. Передайте заголовок Origin или X-Embed-Origin.' });
      return null;
    }

    if (!allowedDomainSet.has(requestDomain)) {
      res.status(403).json({ error: `Домен ${requestDomain} не добавлен в allowlist для данного ключа` });
      return null;
    }
  }

  return {
    apiKey,
    workspaceId: embedKey.workspaceId,
    embedKey,
    knowledgeBaseId: embedKey.knowledgeBaseId,
  };
}

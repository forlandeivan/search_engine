/**
 * Workspace Routes Module
 * 
 * Handles workspace management:
 * - GET /api/workspaces - List user workspaces
 * - POST /api/workspaces/switch - Switch active workspace
 * - GET /api/workspaces/members - List workspace members
 * - POST /api/workspaces/members - Invite member
 * - PATCH /api/workspaces/members/:memberId - Update member role
 * - DELETE /api/workspaces/members/:memberId - Remove member
 * - GET /api/workspaces/:workspaceId/me - Get current user's role
 * - GET/POST/DELETE /api/workspaces/:workspaceId/icon - Workspace icon
 * - GET /api/workspaces/:workspaceId/plan - Get workspace plan
 * - GET /api/workspaces/:workspaceId/credits - Get workspace credits
 * - PUT /api/workspaces/:workspaceId/plan - Update workspace plan
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { workspaceMemberRoles, type PublicUser, type User, actionTargets, actionPlacements, actionInputTypes, actionOutputModes, type ActionPlacement } from '@shared/schema';
import type { WorkspaceMemberWithUser } from '../storage';
import { actionsRepository } from '../actions';
import {
  getWorkspaceLlmUsageSummary,
  getWorkspaceAsrUsageSummary,
  getWorkspaceEmbeddingUsageSummary,
  getWorkspaceStorageUsageSummary,
  getWorkspaceObjectsUsageSummary,
  getWorkspaceQdrantUsage,
} from '../usage/usage-service';
import {
  clearWorkspaceIcon,
  uploadWorkspaceIcon,
  workspaceIconUpload,
  WorkspaceIconError,
  getWorkspaceIcon,
} from '../workspace-icon-service';

const workspaceLogger = createLogger('workspace');

// Create router instance
export const workspaceRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface WorkspaceMemberResponse {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: string;
  isCurrentUser: boolean;
  joinedAt: string;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
});

const inviteWorkspaceMemberSchema = z.object({
  email: z.string().email('Некорректный email'),
  role: z.enum(workspaceMemberRoles).default('member'),
});

const updateWorkspaceMemberSchema = z.object({
  role: z.enum(workspaceMemberRoles),
});

// ============================================================================
// Helper Functions
// ============================================================================

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    isEmailConfirmed: user.isEmailConfirmed,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    lastActivityAt: user.lastActivityAt,
  };
}

function getSessionUser(req: Request): PublicUser | null {
  return req.user as PublicUser | null;
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | undefined {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return undefined;
  }
  return user;
}

function isWorkspaceAdmin(role: (typeof workspaceMemberRoles)[number]): boolean {
  return role === 'owner' || role === 'manager';
}

function toWorkspaceMemberResponse(
  entry: WorkspaceMemberWithUser,
  currentUserId: string
): WorkspaceMemberResponse {
  const joinedAt = entry.member.createdAt instanceof Date
    ? entry.member.createdAt.toISOString()
    : String(entry.member.createdAt);

  return {
    id: entry.member.id,
    userId: entry.user.id,
    email: entry.user.email,
    fullName: entry.user.fullName,
    role: entry.member.role,
    isCurrentUser: entry.user.id === currentUserId,
    joinedAt,
  };
}

interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  role: string;
}

async function ensureWorkspaceContext(
  req: Request,
  user: PublicUser
): Promise<WorkspaceContext | null> {
  const sessionWorkspaceId = req.session?.workspaceId || req.session?.activeWorkspaceId;
  if (sessionWorkspaceId) {
    const membership = await storage.getWorkspaceMember(sessionWorkspaceId, user.id);
    if (membership) {
      const workspace = await storage.getWorkspaceById(sessionWorkspaceId);
      if (workspace) {
        return { workspaceId: workspace.id, workspaceName: workspace.name, role: membership.role };
      }
    }
  }
  const workspaces = await storage.getUserWorkspaces(user.id);
  if (workspaces.length > 0) {
    const first = workspaces[0];
    const membership = await storage.getWorkspaceMember(first.id, user.id);
    if (req.session) {
      req.session.workspaceId = first.id;
      req.session.activeWorkspaceId = first.id;
    }
    return { workspaceId: first.id, workspaceName: first.name, role: membership?.role || 'member' };
  }
  return null;
}

function buildSessionResponse(user: PublicUser, context: WorkspaceContext | null) {
  return {
    workspace: context ? { active: { id: context.workspaceId, name: context.workspaceName } } : undefined,
  };
}

function getRequestWorkspace(req: Request): { id: string } {
  const workspaceId = req.workspaceId || 
                      req.params.workspaceId || 
                      req.session?.workspaceId ||
                      req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/workspaces
 * List user workspaces
 */
workspaceRouter.get('/', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const context = await ensureWorkspaceContext(req, user);
  const workspaceResponse = buildSessionResponse(user, context).workspace;
  
  // Also include available workspaces
  const workspaces = await storage.getUserWorkspaces(user.id);
  const available = workspaces.map((w) => ({ id: w.id, name: w.name }));
  
  res.json({ ...workspaceResponse, available });
}));

/**
 * POST /api/workspaces/switch
 * Switch active workspace
 */
workspaceRouter.post('/switch', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const payload = switchWorkspaceSchema.parse(req.body ?? {});
    const workspaceId = payload.workspaceId.trim();

    const workspace = await storage.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: `Workspace '${workspaceId}' does not exist` });
    }

    const membership = await storage.getWorkspaceMember(user.id, workspaceId);
    if (!membership) {
      return res.status(403).json({ message: 'You do not have access to this workspace' });
    }

    if (req.session) {
      req.session.activeWorkspaceId = workspaceId;
      req.session.workspaceId = workspaceId;
    }

    req.workspaceId = workspaceId;
    req.workspaceRole = membership.role;

    res.json({
      workspaceId,
      status: 'ok',
      role: membership.role,
      name: workspace.name ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues.at(0);
      return res.status(400).json({
        message: issue?.message ?? 'workspaceId is required',
        details: error.issues,
      });
    }
    throw error;
  }
}));

/**
 * GET /api/workspaces/members
 * List workspace members
 */
workspaceRouter.get('/members', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const members = await storage.listWorkspaceMembers(workspaceId);
  res.json({ members: members.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
}));

/**
 * POST /api/workspaces/members
 * Invite member to workspace
 */
workspaceRouter.post('/members', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const payload = inviteWorkspaceMemberSchema.parse(req.body);
    const normalizedEmail = payload.email.trim().toLowerCase();
    const targetUser = await storage.getUserByEmail(normalizedEmail);
    if (!targetUser) {
      return res.status(404).json({ message: 'Пользователь с таким email не найден' });
    }

    const { id: workspaceId } = getRequestWorkspace(req);
    const existingMembers = await storage.listWorkspaceMembers(workspaceId);
    if (existingMembers.some((entry) => entry.user.id === targetUser.id)) {
      return res.status(409).json({ message: 'Пользователь уже состоит в рабочем пространстве' });
    }

    await storage.addWorkspaceMember(workspaceId, targetUser.id, payload.role);
    const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
    res.status(201).json({
      members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    throw error;
  }
}));

/**
 * PATCH /api/workspaces/members/:memberId
 * Update member role
 */
workspaceRouter.patch('/members/:memberId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const payload = updateWorkspaceMemberSchema.parse(req.body);
    const { id: workspaceId } = getRequestWorkspace(req);
    const members = await storage.listWorkspaceMembers(workspaceId);
    const target = members.find((entry) => entry.user.id === req.params.memberId);
    if (!target) {
      return res.status(404).json({ message: 'Участник не найден' });
    }

    const ownerCount = members.filter((entry) => entry.member.role === 'owner').length;
    if (target.member.role === 'owner' && payload.role !== 'owner' && ownerCount <= 1) {
      return res.status(400).json({ message: 'Нельзя изменить роль единственного владельца' });
    }

    await storage.updateWorkspaceMemberRole(workspaceId, target.user.id, payload.role);
    const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
    res.json({ members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    throw error;
  }
}));

/**
 * DELETE /api/workspaces/members/:memberId
 * Remove member from workspace
 */
workspaceRouter.delete('/members/:memberId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const memberId = req.params.memberId;
  if (memberId === user.id) {
    return res.status(400).json({ message: 'Нельзя удалить самого себя из рабочего пространства' });
  }

  const { id: workspaceId } = getRequestWorkspace(req);
  const members = await storage.listWorkspaceMembers(workspaceId);
  const target = members.find((entry) => entry.user.id === memberId);
  if (!target) {
    return res.status(404).json({ message: 'Участник не найден' });
  }

  const ownerCount = members.filter((entry) => entry.member.role === 'owner').length;
  if (target.member.role === 'owner' && ownerCount <= 1) {
    return res.status(400).json({ message: 'Нельзя удалить единственного владельца' });
  }

  const removed = await storage.removeWorkspaceMember(workspaceId, memberId);
  if (!removed) {
    return res.status(404).json({ message: 'Участник не найден' });
  }

  const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
  res.json({ members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)) });
}));

/**
 * GET /api/workspaces/:workspaceId/me
 * Get current user's role in workspace
 */
workspaceRouter.get('/:workspaceId/me', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(workspaceId, user.id);
  if (!membership) {
    return res.status(403).json({ message: 'You do not have access to this workspace' });
  }

  res.json({
    workspaceId,
    userId: user.id,
    role: membership.role,
    status: membership.status,
  });
}));

/**
 * POST /api/workspaces/:workspaceId/icon
 * Upload workspace icon
 */
workspaceRouter.post(
  '/:workspaceId/icon',
  workspaceIconUpload.single('file'),
  asyncHandler(async (req, res) => {
    const user = getAuthorizedUser(req, res);
    if (!user) return;

    const { workspaceId } = req.params;
    const membership = await storage.getWorkspaceMember(workspaceId, user.id);
    if (!membership || !isWorkspaceAdmin(membership.role)) {
      return res.status(403).json({ message: 'forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'file is required' });
    }

    try {
      const result = await uploadWorkspaceIcon(workspaceId, req.file);
      res.json({ iconUrl: result.iconUrl, iconKey: result.iconKey });
    } catch (error) {
      if (error instanceof WorkspaceIconError) {
        return res.status(error.status ?? 400).json({ message: error.message });
      }
      throw error;
    }
  })
);

/**
 * DELETE /api/workspaces/:workspaceId/icon
 * Delete workspace icon
 */
workspaceRouter.delete('/:workspaceId/icon', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(workspaceId, user.id);
  if (!membership || !isWorkspaceAdmin(membership.role)) {
    return res.status(403).json({ message: 'forbidden' });
  }

  await clearWorkspaceIcon(workspaceId);
  res.json({ iconUrl: null });
}));

/**
 * GET /api/workspaces/:workspaceId/icon
 * Get workspace icon
 */
workspaceRouter.get('/:workspaceId/icon', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(workspaceId, user.id);
  if (!membership) {
    return res.status(403).json({ message: 'forbidden' });
  }

  const icon = await getWorkspaceIcon(workspaceId);
  if (!icon) {
    return res.status(404).json({ message: 'icon not found' });
  }

  if (icon.contentType) {
    res.setHeader('Content-Type', icon.contentType);
  }
  icon.body.pipe(res);
}));

// ============================================================================
// Usage Endpoints
// ============================================================================

/**
 * GET /:workspaceId/usage/llm
 * Get LLM usage summary for workspace
 */
workspaceRouter.get('/:workspaceId/usage/llm', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;
  
  const period = typeof req.query.period === 'string' ? req.query.period : undefined;
  const summary = await getWorkspaceLlmUsageSummary(req.params.workspaceId, period);
  res.json(summary);
}));

/**
 * GET /:workspaceId/usage/asr
 * Get ASR usage summary for workspace
 */
workspaceRouter.get('/:workspaceId/usage/asr', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;
  
  const period = typeof req.query.period === 'string' ? req.query.period : undefined;
  const summary = await getWorkspaceAsrUsageSummary(req.params.workspaceId, period);
  res.json(summary);
}));

/**
 * GET /:workspaceId/usage/embeddings
 * Get embeddings usage summary for workspace
 */
workspaceRouter.get('/:workspaceId/usage/embeddings', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;
  
  const period = typeof req.query.period === 'string' ? req.query.period : undefined;
  const summary = await getWorkspaceEmbeddingUsageSummary(req.params.workspaceId, period);
  res.json(summary);
}));

/**
 * GET /:workspaceId/usage/storage
 * Get storage usage summary for workspace
 */
workspaceRouter.get('/:workspaceId/usage/storage', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;
  
  const period = typeof req.query.period === 'string' ? req.query.period : undefined;
  const summary = await getWorkspaceStorageUsageSummary(req.params.workspaceId, period);
  res.json(summary);
}));

/**
 * GET /:workspaceId/usage/objects
 * Get objects usage summary for workspace
 */
workspaceRouter.get('/:workspaceId/usage/objects', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;
  
  const period = typeof req.query.period === 'string' ? req.query.period : undefined;
  const summary = await getWorkspaceObjectsUsageSummary(req.params.workspaceId, period);
  res.json(summary);
}));

/**
 * GET /:workspaceId/usage/qdrant
 * Get Qdrant usage for workspace
 */
workspaceRouter.get('/:workspaceId/usage/qdrant', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;
  
  const usage = await getWorkspaceQdrantUsage(req.params.workspaceId);
  res.json(usage);
}));

// ============================================================================
// Workspace Actions Endpoints
// ============================================================================

/**
 * GET /:workspaceId/actions
 * List workspace actions
 */
workspaceRouter.get('/:workspaceId/actions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceId = req.workspaceContext?.workspaceId ?? req.params.workspaceId;
  const actions = await actionsRepository.listForWorkspace(workspaceId, { includeSystem: true });
  const payload = actions.map((action) => ({
    ...action,
    editable: action.scope === 'workspace' && action.workspaceId === workspaceId,
  }));
  res.json({ actions: payload });
}));

/**
 * POST /:workspaceId/actions
 * Create workspace action
 */
workspaceRouter.post('/:workspaceId/actions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceId = req.workspaceContext?.workspaceId ?? req.params.workspaceId;
  const body = req.body ?? {};

  if (!body.label || typeof body.label !== 'string') {
    return res.status(400).json({ message: 'label is required' });
  }
  if (!actionTargets.includes(body.target)) {
    return res.status(400).json({ message: 'invalid target' });
  }
  if (
    !Array.isArray(body.placements) ||
    body.placements.some((p: unknown) => !actionPlacements.includes(p as ActionPlacement))
  ) {
    return res.status(400).json({ message: 'invalid placements' });
  }
  if (!body.promptTemplate || typeof body.promptTemplate !== 'string') {
    return res.status(400).json({ message: 'promptTemplate is required' });
  }
  if (!actionInputTypes.includes(body.inputType)) {
    return res.status(400).json({ message: 'invalid inputType' });
  }
  if (!actionOutputModes.includes(body.outputMode)) {
    return res.status(400).json({ message: 'invalid outputMode' });
  }

  const target = body.target as (typeof actionTargets)[number];
  const inputType = body.inputType as (typeof actionInputTypes)[number];
  const outputMode = body.outputMode as (typeof actionOutputModes)[number];
  const placements = (body.placements as ActionPlacement[]).filter((p) => actionPlacements.includes(p));

  const created = await actionsRepository.createWorkspaceAction(workspaceId, {
    label: body.label,
    description: typeof body.description === 'string' ? body.description : null,
    target,
    placements,
    promptTemplate: body.promptTemplate,
    inputType,
    outputMode,
    llmConfigId: null,
  });

  res.status(201).json({
    action: {
      ...created,
      editable: true,
    },
  });
}));

/**
 * PATCH /:workspaceId/actions/:actionId
 * Update workspace action
 */
workspaceRouter.patch('/:workspaceId/actions/:actionId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId, actionId } = req.params;
  const body = req.body ?? {};

  const patch: Record<string, unknown> = {};
  if (typeof body.label === 'string') patch.label = body.label;
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description;
  if (body.target && actionTargets.includes(body.target)) {
    patch.target = body.target as (typeof actionTargets)[number];
  }
  if (
    Array.isArray(body.placements) &&
    body.placements.every((p: unknown) => actionPlacements.includes(p as ActionPlacement))
  ) {
    patch.placements = (body.placements as ActionPlacement[]).filter((p) => actionPlacements.includes(p));
  }
  if (typeof body.promptTemplate === 'string') patch.promptTemplate = body.promptTemplate;
  if (body.inputType && actionInputTypes.includes(body.inputType)) {
    patch.inputType = body.inputType as (typeof actionInputTypes)[number];
  }
  if (body.outputMode && actionOutputModes.includes(body.outputMode)) {
    patch.outputMode = body.outputMode as (typeof actionOutputModes)[number];
  }

  const updated = await actionsRepository.updateWorkspaceAction(workspaceId, actionId, patch);
  res.json({
    action: {
      ...updated,
      editable: true,
    },
  });
}));

/**
 * DELETE /:workspaceId/actions/:actionId
 * Delete workspace action
 */
workspaceRouter.delete('/:workspaceId/actions/:actionId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId, actionId } = req.params;
  await actionsRepository.softDeleteWorkspaceAction(workspaceId, actionId);
  res.status(204).send();
}));

export default workspaceRouter;

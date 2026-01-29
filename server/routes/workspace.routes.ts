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
 * - PATCH /api/workspaces/:workspaceId - Update workspace name
 * - GET /api/workspaces/:workspaceId/plan - Get workspace plan
 * - GET /api/workspaces/:workspaceId/credits - Get workspace credits
 * - GET /api/workspaces/:workspaceId/dashboard-summary - Get dashboard summary (optimized)
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
import { workspacePlanService, PlanDowngradeNotAllowedError } from '../workspace-plan-service';
import { getWorkspaceCreditSummary } from '../credit-summary-service';
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
import {
  createInvitation,
  listPendingInvitations,
  cancelInvitation,
  resendInvitation,
  getInvitationWithWorkspaceById,
  InvitationError,
} from '../workspace-invitation-service';
import { workspaceInvitationEmailService } from '../email-sender-registry';

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
    lastActivityAt: user.lastActiveAt,
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

function resolveFrontendBaseUrl(req: Request): string {
  const envBase = process.env.FRONTEND_URL || process.env.PUBLIC_URL;
  if (envBase) return envBase;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('http')) return origin;
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  return host ? `${proto}://${host}` : 'http://localhost:5000';
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
    const membership = await storage.getWorkspaceMember(user.id, sessionWorkspaceId);
    if (membership) {
      const workspace = await storage.getWorkspace(sessionWorkspaceId);
      if (workspace) {
        return { workspaceId: workspace.id, workspaceName: workspace.name, role: membership.role };
      }
    }
  }
  const workspaces = await storage.getOrCreateUserWorkspaces(user.id);
  if (workspaces.length > 0) {
    const first = workspaces[0];
    const membership = await storage.getWorkspaceMember(user.id, first.id);
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
  // Check header first (most common from frontend)
  const headerWorkspaceRaw = req.headers["x-workspace-id"];
  const headerWorkspaceId = Array.isArray(headerWorkspaceRaw)
    ? headerWorkspaceRaw[0]
    : typeof headerWorkspaceRaw === "string"
      ? headerWorkspaceRaw.trim()
      : undefined;

  const workspaceId = req.workspaceId || 
                      req.workspaceContext?.workspaceId ||
                      headerWorkspaceId ||
                      req.params.workspaceId ||
                      req.query.workspaceId ||
                      req.session?.workspaceId ||
                      req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: String(workspaceId) };
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
  const workspaces = await storage.getOrCreateUserWorkspaces(user.id);
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
 * 
 * If user exists: adds to workspace immediately and sends notification
 * If user doesn't exist: creates invitation and sends invite email
 */
workspaceRouter.post('/members', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const payload = inviteWorkspaceMemberSchema.parse(req.body);
    const normalizedEmail = payload.email.trim().toLowerCase();
    const { id: workspaceId } = getRequestWorkspace(req);

    // Get workspace info for email
    const workspace = await storage.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ message: 'Рабочее пространство не найдено' });
    }

    // Check if current user has permission to invite
    const currentMembership = await storage.getWorkspaceMember(user.id, workspaceId);
    if (!currentMembership || !isWorkspaceAdmin(currentMembership.role)) {
      return res.status(403).json({ message: 'Только владелец или менеджер могут приглашать участников' });
    }

    const targetUser = await storage.getUserByEmail(normalizedEmail);
    
    if (targetUser) {
      // User exists - add directly to workspace
      const existingMembers = await storage.listWorkspaceMembers(workspaceId);
      if (existingMembers.some((entry) => entry.user.id === targetUser.id)) {
        return res.status(409).json({ message: 'Пользователь уже состоит в рабочем пространстве' });
      }

      await storage.addWorkspaceMember(workspaceId, targetUser.id, payload.role);
      
      // Send notification email (non-blocking)
      const baseUrl = resolveFrontendBaseUrl(req);
      const workspaceLink = `${baseUrl}/?workspace=${workspaceId}`;
      workspaceInvitationEmailService.sendWorkspaceMemberAddedEmail({
        recipientEmail: targetUser.email,
        recipientName: targetUser.fullName,
        workspaceName: workspace.name,
        inviterName: user.fullName,
        workspaceLink,
      }).catch((err) => {
        workspaceLogger.error({ err, userId: targetUser.id, workspaceId }, 'Failed to send member added email');
      });

      const updatedMembers = await storage.listWorkspaceMembers(workspaceId);
      return res.status(201).json({
        added: true,
        invited: false,
        members: updatedMembers.map((entry) => toWorkspaceMemberResponse(entry, user.id)),
      });
    } else {
      // User doesn't exist - create invitation
      const result = await createInvitation({
        workspaceId,
        email: normalizedEmail,
        role: payload.role,
        invitedByUserId: user.id,
      });

      // Send invitation email
      const baseUrl = resolveFrontendBaseUrl(req);
      const inviteLink = `${baseUrl}/invite/${result.invitation.token}`;
      
      await workspaceInvitationEmailService.sendWorkspaceInvitationEmail({
        recipientEmail: normalizedEmail,
        workspaceName: workspace.name,
        inviterName: user.fullName,
        inviteLink,
      });

      return res.status(201).json({
        added: false,
        invited: true,
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          expiresAt: result.invitation.expiresAt.toISOString(),
        },
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    if (error instanceof InvitationError) {
      const statusCodes: Record<string, number> = {
        ALREADY_MEMBER: 409,
        INVITATION_EXISTS: 409,
      };
      return res.status(statusCodes[error.code] || 400).json({ 
        message: error.message,
        code: error.code,
      });
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

// ============================================================================
// Invitation Endpoints
// ============================================================================

/**
 * GET /api/workspaces/invitations
 * List pending invitations for current workspace
 */
workspaceRouter.get('/invitations', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  
  const invitations = await listPendingInvitations(workspaceId);
  
  res.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      createdAt: inv.createdAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
      invitedBy: inv.invitedBy,
    })),
  });
}));

/**
 * DELETE /api/workspaces/invitations/:invitationId
 * Cancel an invitation
 */
workspaceRouter.delete('/invitations/:invitationId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const { invitationId } = req.params;

  // Check permission
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership || !isWorkspaceAdmin(membership.role)) {
    return res.status(403).json({ message: 'Только владелец или менеджер могут отменять приглашения' });
  }

  const cancelled = await cancelInvitation(invitationId, workspaceId);
  
  if (!cancelled) {
    return res.status(404).json({ message: 'Приглашение не найдено или уже использовано' });
  }

  res.status(204).send();
}));

/**
 * POST /api/workspaces/invitations/:invitationId/resend
 * Resend an invitation with new token
 */
workspaceRouter.post('/invitations/:invitationId/resend', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const { invitationId } = req.params;

  // Check permission
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership || !isWorkspaceAdmin(membership.role)) {
    return res.status(403).json({ message: 'Только владелец или менеджер могут повторно отправлять приглашения' });
  }

  const updated = await resendInvitation(invitationId, workspaceId);
  
  if (!updated) {
    return res.status(404).json({ message: 'Приглашение не найдено или уже использовано' });
  }

  // Get workspace info for email
  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) {
    return res.status(404).json({ message: 'Рабочее пространство не найдено' });
  }

  // Send invitation email
  const baseUrl = resolveFrontendBaseUrl(req);
  const inviteLink = `${baseUrl}/invite/${updated.token}`;
  
  await workspaceInvitationEmailService.sendWorkspaceInvitationEmail({
    recipientEmail: updated.email,
    workspaceName: workspace.name,
    inviterName: user.fullName,
    inviteLink,
  });

  res.json({
    invitation: {
      id: updated.id,
      email: updated.email,
      expiresAt: updated.expiresAt.toISOString(),
    },
    message: 'Приглашение отправлено повторно',
  });
}));

/**
 * GET /api/workspaces/:workspaceId/me
 * Get current user's role in workspace
 */
workspaceRouter.get('/:workspaceId/me', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Нет доступа к этому рабочему пространству' });
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
    const membership = await storage.getWorkspaceMember(user.id, workspaceId);
    if (!membership || !isWorkspaceAdmin(membership.role)) {
      return res.status(403).json({ message: 'Доступ запрещён' });
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
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership || !isWorkspaceAdmin(membership.role)) {
    return res.status(403).json({ message: 'Доступ запрещён' });
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
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
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

/**
 * PATCH /api/workspaces/:workspaceId
 * Update workspace name
 */
const updateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Название не может быть пустым")
    .max(200, "Название не должно превышать 200 символов"),
});

workspaceRouter.patch('/:workspaceId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership || !isWorkspaceAdmin(membership.role)) {
    return res.status(403).json({ message: 'Доступ запрещён. Только владелец или менеджер могут изменять название рабочего пространства' });
  }

  try {
    const payload = updateWorkspaceSchema.parse(req.body);
    const updated = await storage.updateWorkspaceName(workspaceId, payload.name);
    
    if (!updated) {
      return res.status(404).json({ message: 'Рабочее пространство не найдено' });
    }

    res.json({ 
      workspace: {
        id: updated.id,
        name: updated.name,
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues.at(0);
      return res.status(400).json({
        message: issue?.message ?? 'Некорректные данные',
        details: error.issues,
      });
    }
    if (error instanceof Error) {
      return res.status(400).json({ message: error.message });
    }
    throw error;
  }
}));

// ============================================================================
// Plan Endpoints
// ============================================================================

/**
 * GET /:workspaceId/plan
 * Get workspace plan
 */
workspaceRouter.get('/:workspaceId/plan', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const plan = await workspacePlanService.getWorkspacePlan(workspaceId);
  workspaceLogger.info(`[GET /:workspaceId/plan] workspaceId: ${workspaceId}, plan: ${plan.code}, noCodeFlowEnabled: ${plan.noCodeFlowEnabled}`);
  res.json({ plan });
}));

/**
 * PUT /:workspaceId/plan
 * Update workspace plan
 */
workspaceRouter.put('/:workspaceId/plan', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  // Проверяем, что пользователь имеет право менять тариф (обычно только owner или admin)
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return res.status(403).json({ message: 'Только владелец или администратор могут менять тариф' });
  }

  const { planCode } = req.body;
  if (!planCode || typeof planCode !== 'string') {
    return res.status(400).json({ message: 'Необходимо указать planCode' });
  }

  try {
    const plan = await workspacePlanService.updateWorkspacePlan(workspaceId, planCode);
    res.json({ plan });
  } catch (error) {
    if (error instanceof PlanDowngradeNotAllowedError) {
      return res.status(400).json({ 
        message: error.message,
        code: error.code,
        violations: error.violations,
      });
    }
    if (error instanceof Error) {
      return res.status(400).json({ message: error.message });
    }
    throw error;
  }
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

// ============================================================================
// Skill Files Endpoints
// ============================================================================

/**
 * GET /:workspaceId/skills/:skillId/files
 * List skill files
 */
workspaceRouter.get('/:workspaceId/skills/:skillId/files', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId, skillId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const files = await storage.listSkillFiles(workspaceId, skillId);
  res.json({ files });
}));

/**
 * DELETE /:workspaceId/skills/:skillId/files/:fileId
 * Delete skill file
 */
workspaceRouter.delete('/:workspaceId/skills/:skillId/files/:fileId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId, skillId, fileId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const deleted = await storage.deleteSkillFile(fileId, workspaceId, skillId);
  if (!deleted) {
    return res.status(404).json({ message: 'Файл не найден' });
  }

  res.status(204).send();
}));

/**
 * GET /:workspaceId/credits
 * Get workspace credits balance
 */
workspaceRouter.get('/:workspaceId/credits', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) {
    return res.status(404).json({ message: 'Рабочее пространство не найдено' });
  }

  const summary = await getWorkspaceCreditSummary(workspaceId);
  const plan = await workspacePlanService.getWorkspacePlan(workspaceId);

  res.json({
    workspaceId: summary.workspaceId,
    balance: {
      currentBalance: summary.currentBalance,
      nextTopUpAt: summary.nextRefreshAt ? summary.nextRefreshAt.toISOString() : null,
    },
    planIncludedCredits: {
      amount: summary.planLimit.amount,
      period: summary.planLimit.period,
    },
    policy: summary.policy,
  });
}));

/**
 * GET /:workspaceId/dashboard-summary
 * Get complete dashboard summary (optimized single endpoint)
 */
workspaceRouter.get('/:workspaceId/dashboard-summary', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) {
    return res.status(404).json({ message: 'Рабочее пространство не найдено' });
  }

  const { getDashboardSummary } = await import('../dashboard-service');
  const summary = await getDashboardSummary(workspaceId, user.id, membership.role);

  res.set('Cache-Control', 'private, max-age=30');
  res.json(summary);
}));

// ============================================================================
// Transcript Routes
// ============================================================================

/**
 * GET /:workspaceId/transcripts/:transcriptId
 * Get transcript by ID
 */
workspaceRouter.get('/:workspaceId/transcripts/:transcriptId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId, transcriptId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const transcript = await storage.getTranscriptById?.(transcriptId);
  if (!transcript || transcript.workspaceId !== workspaceId) {
    return res.status(404).json({ message: 'Транскрипт не найден' });
  }

  res.json(transcript);
}));

/**
 * PATCH /:workspaceId/transcripts/:transcriptId
 * Update transcript
 */
workspaceRouter.patch('/:workspaceId/transcripts/:transcriptId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { workspaceId, transcriptId } = req.params;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  const transcript = await storage.getTranscriptById?.(transcriptId);
  if (!transcript || transcript.workspaceId !== workspaceId) {
    return res.status(404).json({ message: 'Транскрипт не найден' });
  }

  const updateSchema = z.object({
    fullText: z.string().optional(),
    title: z.string().optional(),
  });

  const payload = updateSchema.parse(req.body ?? {});
  
  const updated = await storage.updateTranscript(transcriptId, {
    ...payload,
    lastEditedByUserId: user.id,
  });

  if (!updated) {
    return res.status(500).json({ message: 'Не удалось обновить транскрипт' });
  }

  res.json(updated);
}));

export default workspaceRouter;

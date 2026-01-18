/**
 * Skill Routes Module
 * 
 * Handles skill CRUD operations:
 * - GET /api/skills - List skills
 * - POST /api/skills - Create skill
 * - PUT /api/skills/:skillId - Update skill
 * - DELETE /api/skills/:skillId - Archive skill
 * - GET /api/skills/:skillId/actions - List skill actions
 */

import { Router, type Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  listSkills,
  createSkill,
  updateSkill,
  archiveSkill,
  getSkillById,
  SkillServiceError,
  generateNoCodeCallbackToken,
} from '../skills';
import { actionsRepository } from '../actions';
import { skillActionsRepository } from '../skill-actions';
import type { PublicUser } from '@shared/schema';
import type { ActionPlacement } from '@shared/schema';

const logger = createLogger('skill');

export const skillRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: Request): PublicUser | null {
  return (req as Request & { user?: PublicUser }).user ?? null;
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return null;
  }
  return user;
}

function getRequestWorkspace(req: Request): { id: string } {
  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    req.params.workspaceId ||
    req.query.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: String(workspaceId) };
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function resolveWorkspaceIdForRequest(req: Request, explicitId: string | null | undefined): string {
  if (explicitId && explicitId.trim().length > 0) {
    return explicitId.trim();
  }
  return getRequestWorkspace(req).id;
}

const actionPlacements: ActionPlacement[] = ['inline', 'context_menu', 'side_panel', 'transcript_menu', 'transcript_block'];

// ============================================================================
// Validation Schemas
// ============================================================================

const createSkillSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['LLM_SKILL', 'RAG_SKILL']).optional(),
  modelId: z.string().trim().min(1).optional(),
  systemPrompt: z.string().trim().max(10000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(100000).optional(),
});

const updateSkillSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).optional(),
  modelId: z.string().trim().min(1).optional(),
  systemPrompt: z.string().trim().max(10000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(100000).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /
 * List skills for workspace
 */
skillRouter.get('/', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const includeArchived = req.query?.status === 'all' || req.query?.status === 'archived';
  
  const skillsList = await listSkills(workspaceId, { includeArchived });
  res.json({ skills: skillsList });
}));

/**
 * POST /
 * Create new skill
 */
skillRouter.post('/', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createSkillSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const skill = await createSkill(workspaceId, payload);
  res.status(201).json({ skill });
}));

/**
 * PUT /:skillId
 * Update skill
 */
skillRouter.put('/:skillId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = updateSkillSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  const { skillId } = req.params;
  
  if (!skillId) {
    return res.status(400).json({ message: 'Не указан идентификатор навыка' });
  }

  const skill = await updateSkill(workspaceId, skillId, payload);
  res.json({ skill });
}));

/**
 * DELETE /:skillId
 * Archive skill
 */
skillRouter.delete('/:skillId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const { skillId } = req.params;
  
  if (!skillId) {
    return res.status(400).json({ message: 'Не указан идентификатор навыка' });
  }

  await archiveSkill(workspaceId, skillId);
  res.status(204).send();
}));

/**
 * GET /:skillId
 * Get skill by ID
 */
skillRouter.get('/:skillId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const { skillId } = req.params;
  
  const skill = await getSkillById(workspaceId, skillId);
  if (!skill) {
    return res.status(404).json({ message: 'Навык не найден' });
  }

  res.json({ skill });
}));

/**
 * GET /:skillId/actions
 * List skill actions configuration
 */
skillRouter.get('/:skillId/actions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { skillId } = req.params;
  const workspaceCandidate = pickFirstString(req.query.workspaceId, req.query.workspace_id);
  const workspaceId = resolveWorkspaceIdForRequest(req, workspaceCandidate);
  
  const skill = await getSkillById(workspaceId, skillId);
  if (!skill) {
    return res.status(404).json({ message: 'Skill not found' });
  }

  const actions = await actionsRepository.listForWorkspace(skill.workspaceId, { includeSystem: true });
  const skillActions = await skillActionsRepository.listForSkill(skillId);
  const skillActionMap = new Map(skillActions.map((sa) => [sa.actionId, sa]));

  const items = actions.map((action) => {
    const sa = skillActionMap.get(action.id);
    const effectiveLabel = sa?.labelOverride ?? action.label;
    const editable =
      action.scope === 'system' ||
      (action.scope === 'workspace' && action.workspaceId === skill.workspaceId);

    return {
      action,
      skillAction: sa
        ? {
            enabled: sa.enabled,
            enabledPlacements: sa.enabledPlacements,
            labelOverride: sa.labelOverride,
          }
        : null,
      ui: {
        effectiveLabel,
        editable,
      },
    };
  });

  res.json({ items });
}));

/**
 * PUT /:skillId/actions/:actionId
 * Update skill action configuration
 */
skillRouter.put('/:skillId/actions/:actionId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { skillId, actionId } = req.params;
  const body = req.body ?? {};

  if (typeof body.enabled !== 'boolean') {
    return res.status(400).json({ message: 'enabled is required' });
  }
  if (
    !Array.isArray(body.enabledPlacements) ||
    body.enabledPlacements.some((p: unknown) => !actionPlacements.includes(p as ActionPlacement))
  ) {
    return res.status(400).json({ message: 'invalid enabledPlacements' });
  }
  const enabledPlacements = body.enabledPlacements as ActionPlacement[];

  const workspaceCandidate = pickFirstString(req.query.workspaceId, req.query.workspace_id);
  const workspaceId = resolveWorkspaceIdForRequest(req, workspaceCandidate);
  const skill = await getSkillById(workspaceId, skillId);
  if (!skill) {
    return res.status(404).json({ message: 'Skill not found' });
  }

  const action = await actionsRepository.getByIdForWorkspace(skill.workspaceId, actionId);
  if (!action) {
    return res.status(404).json({ message: 'Action not found for this workspace' });
  }

  // Check that enabledPlacements ⊆ action.placements
  const allowedPlacements = (action.placements ?? []) as ActionPlacement[];
  const isSubset = enabledPlacements.every((p: ActionPlacement) => allowedPlacements.includes(p));
  if (!isSubset) {
    return res.status(400).json({ message: 'enabledPlacements must be subset of action.placements' });
  }

  const updatedSkillAction = await skillActionsRepository.upsertForSkill(
    skill.workspaceId,
    skillId,
    actionId,
    {
      enabled: body.enabled,
      enabledPlacements,
      labelOverride:
        typeof body.labelOverride === 'string' || body.labelOverride === null
          ? body.labelOverride
          : undefined,
    },
  );

  res.json({
    action,
    skillAction: {
      enabled: updatedSkillAction.enabled,
      enabledPlacements: updatedSkillAction.enabledPlacements,
      labelOverride: updatedSkillAction.labelOverride,
    },
    ui: {
      effectiveLabel: updatedSkillAction.labelOverride ?? action.label,
      editable: true,
    },
  });
}));

/**
 * POST /:skillId/no-code/callback-token
 * Generate no-code callback token for skill
 */
skillRouter.post('/:skillId/no-code/callback-token', asyncHandler(async (req, res) => {
  const workspaceId = resolveWorkspaceIdForRequest(req, null);
  const skillId = req.params.skillId;
  if (!skillId) {
    return res.status(400).json({ message: 'Не указан идентификатор навыка' });
  }

  const result = await generateNoCodeCallbackToken({ workspaceId, skillId });
  return res.status(201).json({
    token: result.token,
    lastFour: result.lastFour,
    rotatedAt: result.rotatedAt,
    skill: result.skill,
  });
}));

// Error handler for this router
skillRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: 'Некорректные данные', details: err.issues });
  }
  if (err instanceof SkillServiceError) {
    return res.status(err.status).json({ 
      message: err.message, 
      ...(err.code ? { errorCode: err.code } : {}) 
    });
  }
  next(err);
});

export default skillRouter;

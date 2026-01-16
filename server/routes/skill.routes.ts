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
} from '../skills';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('skill');

export const skillRouter = Router();

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
 * List skill actions
 */
skillRouter.get('/:skillId/actions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const { skillId } = req.params;
  
  const skill = await getSkillById(workspaceId, skillId);
  if (!skill) {
    return res.status(404).json({ message: 'Навык не найден' });
  }

  const actions = await storage.listSkillActions(skillId);
  res.json({ actions });
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

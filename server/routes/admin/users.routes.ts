/**
 * Admin Users Routes
 * 
 * Endpoints:
 * - GET /api/admin/users - List all users
 * - PATCH /api/admin/users/:userId/role - Update user role
 * - POST /api/admin/users/:userId/activate - Activate user (confirm email)
 * - DELETE /api/admin/users/:userId - Delete user with all owned workspaces (requires email confirmation)
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { userRoles, type PublicUser, type User } from '@shared/schema';

const logger = createLogger('admin-users');

export const adminUsersRouter = Router();

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

// ============================================================================
// Validation Schemas
// ============================================================================

const updateUserRoleSchema = z.object({
  role: z.enum(userRoles),
});

const deleteUserSchema = z.object({
  confirmEmail: z.string().email("Требуется email для подтверждения"),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /users
 * List all users (admin only)
 */
adminUsersRouter.get('/', asyncHandler(async (_req, res) => {
  const users = await storage.listUsers();
  res.json({ users: users.map((user) => toPublicUser(user)) });
}));

/**
 * PATCH /users/:userId/role
 * Update user role (admin only)
 */
adminUsersRouter.patch('/:userId/role', asyncHandler(async (req, res) => {
  try {
    const { role } = updateUserRoleSchema.parse(req.body);
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'Не указан пользователь' });
    }

    const updatedUser = await storage.updateUserRole(userId, role);
    if (!updatedUser) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    res.json({ user: toPublicUser(updatedUser) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    throw error;
  }
}));

/**
 * POST /users/:userId/activate
 * Activate user by confirming email (admin only)
 */
adminUsersRouter.post('/:userId/activate', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ message: 'Не указан пользователь' });
  }

  const updatedUser = await storage.confirmUserEmail(userId);
  if (!updatedUser) {
    return res.status(404).json({ message: 'Пользователь не найден' });
  }

  res.json({ user: toPublicUser(updatedUser) });
}));

/**
 * DELETE /users/:userId
 * Delete user with all owned workspaces (admin only)
 * Requires email confirmation in request body for safety
 */
adminUsersRouter.delete('/:userId', asyncHandler(async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirmEmail } = deleteUserSchema.parse(req.body);

    if (!userId) {
      return res.status(400).json({ message: 'Не указан пользователь' });
    }

    // Получаем пользователя для проверки email
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Проверяем, что переданный email совпадает с email пользователя
    if (user.email.toLowerCase() !== confirmEmail.toLowerCase()) {
      return res.status(400).json({ 
        message: 'Email для подтверждения не совпадает с email пользователя',
        hint: 'Передайте email пользователя в поле confirmEmail для подтверждения удаления'
      });
    }

    // Получаем список workspace'ов, которые будут удалены
    const ownedWorkspaces = await storage.listUserOwnedWorkspaces(userId);
    
    logger.info({
      userId,
      userEmail: user.email,
      userFullName: user.fullName,
      ownedWorkspacesCount: ownedWorkspaces.length,
      ownedWorkspaceIds: ownedWorkspaces.map(w => w.id),
      ownedWorkspaceNames: ownedWorkspaces.map(w => w.name),
    }, '[DELETE /users/:userId] Starting user deletion process');

    // Удаляем все workspace'ы, где пользователь - владелец
    // (каскадно удалятся все связанные сущности: skills, chats, files, etc)
    const workspaceDeletionResults: Array<{ workspaceId: string; workspaceName: string; success: boolean }> = [];
    
    for (const workspace of ownedWorkspaces) {
      logger.info({ 
        workspaceId: workspace.id, 
        workspaceName: workspace.name,
        userId,
        userEmail: user.email,
      }, '[DELETE /users/:userId] Deleting workspace');
      
      const success = await storage.deleteWorkspace(workspace.id);
      workspaceDeletionResults.push({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        success,
      });
      
      if (success) {
        logger.info({ 
          workspaceId: workspace.id, 
          workspaceName: workspace.name 
        }, '[DELETE /users/:userId] Workspace deleted successfully');
      } else {
        logger.warn({ 
          workspaceId: workspace.id, 
          workspaceName: workspace.name 
        }, '[DELETE /users/:userId] ⚠️ Workspace deletion returned false');
      }
    }

    // Проверяем что все workspace'ы действительно удалились
    const remainingWorkspaces = await storage.listUserOwnedWorkspaces(userId);
    if (remainingWorkspaces.length > 0) {
      logger.error({
        userId,
        userEmail: user.email,
        expectedDeleted: ownedWorkspaces.length,
        remainingCount: remainingWorkspaces.length,
        remainingWorkspaceIds: remainingWorkspaces.map(w => w.id),
      }, '[DELETE /users/:userId] ⚠️ ERROR: Some workspaces were not deleted!');
    }

    // Удаляем самого пользователя
    logger.info({ userId, userEmail: user.email }, '[DELETE /users/:userId] Deleting user');
    const userDeleted = await storage.deleteUser(userId);
    
    if (userDeleted) {
      logger.info({ 
        userId, 
        userEmail: user.email,
        deletedWorkspaces: workspaceDeletionResults.length,
        allWorkspacesDeleted: remainingWorkspaces.length === 0,
      }, '[DELETE /users/:userId] ✅ User deletion completed');
    } else {
      logger.error({ 
        userId, 
        userEmail: user.email 
      }, '[DELETE /users/:userId] ⚠️ ERROR: User deletion returned false');
    }

    res.json({ 
      success: true,
      message: 'Пользователь и все его рабочие пространства удалены',
      deletedUser: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      deletedWorkspaces: ownedWorkspaces.map(w => ({
        id: w.id,
        name: w.name,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        message: 'Некорректные данные. Передайте confirmEmail в теле запроса', 
        details: error.issues 
      });
    }
    throw error;
  }
}));

export default adminUsersRouter;

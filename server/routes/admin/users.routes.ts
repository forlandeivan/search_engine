/**
 * Admin Users Routes
 * 
 * Endpoints:
 * - GET /api/admin/users - List all users
 * - PATCH /api/admin/users/:userId/role - Update user role
 * - POST /api/admin/users/:userId/activate - Activate user (confirm email)
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

export default adminUsersRouter;

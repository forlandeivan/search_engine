/**
 * User Routes Module
 * 
 * Handles user profile and API token management:
 * - GET /api/users/me - Get current user profile
 * - PATCH /api/users/me - Update user profile
 * - POST /api/users/me/password - Change password
 * - GET /api/users/me/api-tokens - List API tokens
 * - POST /api/users/me/api-tokens - Create API token
 * - POST /api/users/me/api-tokens/:tokenId/revoke - Revoke API token
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import type { PublicUser, User, PersonalApiToken } from '@shared/schema';

const userLogger = createLogger('user');

// Create router instance
export const userRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface PersonalApiTokenSummary {
  id: string;
  lastFour: string;
  createdAt: string;
  revokedAt: string | null;
  isActive: boolean;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'Введите имя')
    .max(100, 'Слишком длинное имя'),
  lastName: z
    .string()
    .trim()
    .max(120, 'Слишком длинная фамилия')
    .optional(),
  phone: z
    .string()
    .trim()
    .max(30, 'Слишком длинный номер')
    .optional()
    .refine((value) => !value || /^[0-9+()\s-]*$/.test(value), 'Некорректный номер телефона'),
});

const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(8, 'Минимальная длина пароля 8 символов')
      .max(100, 'Слишком длинный пароль'),
    newPassword: z
      .string()
      .min(8, 'Минимальная длина пароля 8 символов')
      .max(100, 'Слишком длинный пароль'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Новый пароль должен отличаться от текущего',
    path: ['newPassword'],
  });

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert full User to PublicUser (safe for client)
 */
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

/**
 * Get session user from request
 */
function getSessionUser(req: Request): PublicUser | null {
  return req.user as PublicUser | null;
}

/**
 * Get authorized user or send 401 response
 */
function getAuthorizedUser(req: Request, res: Response): PublicUser | undefined {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return undefined;
  }
  return user;
}

/**
 * Convert PersonalApiToken to summary (safe for client)
 */
function toPersonalApiTokenSummary(token: PersonalApiToken): PersonalApiTokenSummary {
  const createdAt = token.createdAt instanceof Date ? token.createdAt.toISOString() : String(token.createdAt);
  const revokedAt = token.revokedAt
    ? token.revokedAt instanceof Date
      ? token.revokedAt.toISOString()
      : String(token.revokedAt)
    : null;

  return {
    id: token.id,
    lastFour: token.lastFour,
    createdAt,
    revokedAt,
    isActive: !token.revokedAt,
  };
}

/**
 * Load user tokens and sync user state
 */
async function loadTokensAndSyncUser(userId: string): Promise<{
  tokens: PersonalApiToken[];
  activeTokens: PersonalApiToken[];
  latestActive: PersonalApiToken | null;
}> {
  const tokens = await storage.listUserPersonalApiTokens(userId);
  const activeTokens = tokens.filter((t) => !t.revokedAt);
  const latestActive = activeTokens.length > 0
    ? activeTokens.reduce((a, b) => {
        const aDate = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
        const bDate = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
        return aDate > bDate ? a : b;
      })
    : null;

  return { tokens, activeTokens, latestActive };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/users/me
 * Get current user profile
 */
userRouter.get('/me', asyncHandler(async (req, res) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  const freshUser = await storage.getUser(sessionUser.id);
  const safeUser = freshUser ? toPublicUser(freshUser) : sessionUser;
  if (freshUser) {
    req.user = safeUser;
  }

  res.json({ user: safeUser });
}));

/**
 * PATCH /api/users/me
 * Update user profile
 */
userRouter.patch('/me', asyncHandler(async (req, res, next) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  try {
    const parsed = updateProfileSchema.parse(req.body);
    const firstName = parsed.firstName.trim();
    const lastName = parsed.lastName?.trim() ?? '';
    const phone = parsed.phone?.trim() ?? '';
    const fullName = [firstName, lastName].filter((part) => part.length > 0).join(' ');

    const updatedUser = await storage.updateUserProfile(sessionUser.id, {
      firstName,
      lastName,
      phone,
      fullName: fullName.length > 0 ? fullName : firstName,
    });

    const refreshedUser = updatedUser ?? (await storage.getUser(sessionUser.id));
    const safeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;

    req.logIn(safeUser, (error) => {
      if (error) {
        return next(error);
      }
      res.json({ user: safeUser });
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    throw error;
  }
}));

/**
 * POST /api/users/me/password
 * Change user password
 */
userRouter.post('/me/password', asyncHandler(async (req, res, next) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const fullUser = await storage.getUser(sessionUser.id);

    if (!fullUser) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (!fullUser.passwordHash) {
      return res.status(400).json({
        message: 'Смена пароля недоступна для аккаунта с входом через Google',
      });
    }

    const isValid = await bcrypt.compare(currentPassword, fullUser.passwordHash);
    if (!isValid) {
      return res.status(400).json({ message: 'Текущий пароль указан неверно' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const updatedUser = await storage.updateUserPassword(sessionUser.id, newPasswordHash);
    const safeUser = toPublicUser(updatedUser ?? fullUser);

    req.logIn(safeUser, (error) => {
      if (error) {
        return next(error);
      }
      res.json({ user: safeUser });
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    throw error;
  }
}));

/**
 * GET /api/users/me/api-tokens
 * List user API tokens
 */
userRouter.get('/me/api-tokens', asyncHandler(async (req, res) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  const tokens = await storage.listUserPersonalApiTokens(sessionUser.id);
  res.json({ tokens: tokens.map(toPersonalApiTokenSummary) });
}));

/**
 * POST /api/users/me/api-tokens
 * Create new API token
 */
userRouter.post('/me/api-tokens', asyncHandler(async (req, res, next) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  const tokenBuffer = randomBytes(32);
  const token = tokenBuffer.toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const lastFour = token.slice(-4);

  await storage.createUserPersonalApiToken(sessionUser.id, { hash, lastFour });

  const { tokens, activeTokens, latestActive } = await loadTokensAndSyncUser(sessionUser.id);
  const refreshedUser = await storage.getUser(sessionUser.id);
  const baseSafeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;
  const safeUser: PublicUser = {
    ...baseSafeUser,
    hasPersonalApiToken: activeTokens.length > 0,
    personalApiTokenLastFour: latestActive ? latestActive.lastFour : null,
    personalApiTokenGeneratedAt: latestActive ? latestActive.createdAt : null,
  };

  req.logIn(safeUser, (error) => {
    if (error) {
      return next(error);
    }
    res.json({
      token,
      user: safeUser,
      tokens: tokens.map(toPersonalApiTokenSummary),
    });
  });
}));

/**
 * POST /api/users/me/api-token (legacy alias)
 */
userRouter.post('/me/api-token', asyncHandler(async (req, res, next) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  const tokenBuffer = randomBytes(32);
  const token = tokenBuffer.toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const lastFour = token.slice(-4);

  await storage.createUserPersonalApiToken(sessionUser.id, { hash, lastFour });

  const { tokens, activeTokens, latestActive } = await loadTokensAndSyncUser(sessionUser.id);
  const refreshedUser = await storage.getUser(sessionUser.id);
  const baseSafeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;
  const safeUser: PublicUser = {
    ...baseSafeUser,
    hasPersonalApiToken: activeTokens.length > 0,
    personalApiTokenLastFour: latestActive ? latestActive.lastFour : null,
    personalApiTokenGeneratedAt: latestActive ? latestActive.createdAt : null,
  };

  req.logIn(safeUser, (error) => {
    if (error) {
      return next(error);
    }
    res.json({
      token,
      user: safeUser,
      tokens: tokens.map(toPersonalApiTokenSummary),
    });
  });
}));

/**
 * POST /api/users/me/api-tokens/:tokenId/revoke
 * Revoke API token
 */
userRouter.post('/me/api-tokens/:tokenId/revoke', asyncHandler(async (req, res, next) => {
  const sessionUser = getAuthorizedUser(req, res);
  if (!sessionUser) {
    return;
  }

  const { tokenId } = req.params;
  if (!tokenId) {
    return res.status(400).json({ message: 'Не указан токен' });
  }

  const revokedToken = await storage.revokeUserPersonalApiToken(sessionUser.id, tokenId);
  if (!revokedToken) {
    return res.status(404).json({ message: 'Токен не найден или уже отозван' });
  }

  const { tokens, activeTokens, latestActive } = await loadTokensAndSyncUser(sessionUser.id);
  const refreshedUser = await storage.getUser(sessionUser.id);
  const baseSafeUser = refreshedUser ? toPublicUser(refreshedUser) : sessionUser;
  const safeUser: PublicUser = {
    ...baseSafeUser,
    hasPersonalApiToken: activeTokens.length > 0,
    personalApiTokenLastFour: latestActive ? latestActive.lastFour : null,
    personalApiTokenGeneratedAt: latestActive ? latestActive.createdAt : null,
  };

  req.logIn(safeUser, (error) => {
    if (error) {
      return next(error);
    }
    res.json({
      user: safeUser,
      tokens: tokens.map(toPersonalApiTokenSummary),
    });
  });
}));

export default userRouter;

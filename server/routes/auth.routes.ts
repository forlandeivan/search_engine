/**
 * Authentication Routes Module
 * 
 * Handles all authentication-related endpoints:
 * - OAuth (Google, Yandex)
 * - Local auth (login, register, logout)
 * - Email confirmation
 * - Session management
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { authLoginLimiter, authRegisterLimiter } from '../middleware/rate-limit';
import { emailConfirmationTokenService, EmailConfirmationTokenError } from '../email-confirmation-token-service';
import { registrationEmailService } from '../email-sender-registry';
import { SmtpSendError } from '../smtp-email-sender';
import { EmailValidationError } from '../email';
import type { PublicUser, User, WorkspaceMember } from '@shared/schema';
import { ensureWorkspaceContext, buildSessionResponse as buildAuthSessionResponse } from '../auth';
import {
  getInvitationByToken,
  validateInvitation,
  acceptInvitation,
  InvitationError,
} from '../workspace-invitation-service';

const authLogger = createLogger('auth');

// Create router instance
export const authRouter = Router();

// OAuth enabled flags - will be set by configureAuthRouter
let _isGoogleAuthEnabled = false;
let _isYandexAuthEnabled = false;

/**
 * Configure auth router with OAuth settings from app
 * Must be called before using the router
 */
export function configureAuthRouter(app: { get: (key: string) => unknown }): void {
  _isGoogleAuthEnabled = Boolean(app.get('googleAuthConfigured'));
  _isYandexAuthEnabled = Boolean(app.get('yandexAuthConfigured'));
  authLogger.info({ google: _isGoogleAuthEnabled, yandex: _isYandexAuthEnabled }, 'Auth router configured');
}

// ============================================================================
// Helper Functions
// ============================================================================

function isGoogleAuthEnabled(): boolean {
  return _isGoogleAuthEnabled;
}

function isYandexAuthEnabled(): boolean {
  return _isYandexAuthEnabled;
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

function sanitizeRedirectPath(path: string | undefined): string {
  if (!path) return '/';
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  if (path.includes('://')) return '/';
  return path;
}

function appendAuthErrorParam(redirectTo: string, provider: string): string {
  const separator = redirectTo.includes('?') ? '&' : '?';
  return `${redirectTo}${separator}auth_error=${provider}`;
}

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

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

async function sendRegistrationEmailWithRetry(
  userEmail: string,
  userDisplayName: string | null,
  confirmationLink: string,
  userId: string,
  maxAttempts: number = 3,
): Promise<{ success: boolean; attempts: number; lastError?: Error }> {
  const delays = [1000, 2000, 4000];
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await registrationEmailService.sendRegistrationConfirmationEmail(
        userEmail,
        userDisplayName,
        confirmationLink,
      );
      authLogger.info({ userId, email: userEmail, attempt }, 'Email sent successfully');
      return { success: true, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      authLogger.warn({ userId, email: userEmail, attempt, error: lastError.message }, 'Email send attempt failed');
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1] || 4000));
      }
    }
  }
  return { success: false, attempts: maxAttempts, lastError };
}


// ============================================================================
// Routes
// ============================================================================

authRouter.get('/providers', (_req, res) => {
  res.json({
    providers: {
      local: { enabled: true },
      google: { enabled: isGoogleAuthEnabled() },
      yandex: { enabled: isYandexAuthEnabled() },
    },
  });
});

authRouter.get('/session', asyncHandler(async (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ message: 'Нет активной сессии' });
  const updatedUser = await storage.recordUserActivity(user.id);
  const safeUser = updatedUser ? toPublicUser(updatedUser) : user;
  if (updatedUser) req.user = safeUser;
  const context = await ensureWorkspaceContext(req, safeUser);
  const activeWorkspaceId = req.session?.activeWorkspaceId ?? req.session?.workspaceId ?? null;
  const sessionResponse = buildAuthSessionResponse(safeUser, context);
  res.json({ ...sessionResponse, activeWorkspaceId });
}));

authRouter.get('/google', (req, res, next) => {
  if (!isGoogleAuthEnabled()) return res.status(404).json({ message: 'Авторизация через Google недоступна' });
  const redirectTo = sanitizeRedirectPath(typeof req.query.redirect === 'string' ? req.query.redirect : undefined);
  if (req.session) req.session.oauthRedirectTo = redirectTo;
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});

authRouter.get('/google/callback', (req, res, next) => {
  if (!isGoogleAuthEnabled()) return res.status(404).json({ message: 'Авторизация через Google недоступна' });
  passport.authenticate('google', (err: unknown, user: PublicUser | false) => {
    const redirectTo = sanitizeRedirectPath(req.session?.oauthRedirectTo ?? '/');
    if (req.session) delete req.session.oauthRedirectTo;
    if (err) { authLogger.error({ err }, 'Google OAuth error'); return res.redirect(appendAuthErrorParam(redirectTo, 'google')); }
    if (!user) return res.redirect(appendAuthErrorParam(redirectTo, 'google'));
    req.logIn(user, (loginError) => { if (loginError) return next(loginError); res.redirect(redirectTo); });
  })(req, res, next);
});

authRouter.get('/yandex', (req, res, next) => {
  if (!isYandexAuthEnabled()) return res.status(404).json({ message: 'Авторизация через Yandex недоступна' });
  const redirectTo = sanitizeRedirectPath(typeof req.query.redirect === 'string' ? req.query.redirect : undefined);
  if (req.session) req.session.oauthRedirectTo = redirectTo;
  passport.authenticate('yandex', { scope: ['login:info', 'login:email'] })(req, res, next);
});

authRouter.get('/yandex/callback', (req, res, next) => {
  if (!isYandexAuthEnabled()) return res.status(404).json({ message: 'Авторизация через Yandex недоступна' });
  passport.authenticate('yandex', (err: unknown, user: PublicUser | false) => {
    const redirectTo = sanitizeRedirectPath(req.session?.oauthRedirectTo ?? '/');
    if (req.session) delete req.session.oauthRedirectTo;
    if (err) { authLogger.error({ err }, 'Yandex OAuth error'); return res.redirect(appendAuthErrorParam(redirectTo, 'yandex')); }
    if (!user) return res.redirect(appendAuthErrorParam(redirectTo, 'yandex'));
    req.logIn(user, (loginError) => { if (loginError) return next(loginError); res.redirect(redirectTo); });
  })(req, res, next);
});

authRouter.post('/register', authRegisterLimiter, asyncHandler(async (req, res, next) => {
  const neutralResponse = { message: 'If this email is not yet registered, a confirmation link has been sent.' };
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const passwordRaw = typeof req.body?.password === 'string' ? req.body.password : '';
  const fullNameRaw = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  if (!emailRaw || emailRaw.length > 255) return res.status(400).json({ message: 'Email is too long' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return res.status(400).json({ message: 'Invalid email format' });
  if (!passwordRaw || passwordRaw.length < 8) return res.status(400).json({ message: 'Password is too short' });
  if (passwordRaw.length > 100 || !(/[A-Za-z]/.test(passwordRaw) && /[0-9]/.test(passwordRaw))) return res.status(400).json({ message: 'Invalid password format' });
  if (fullNameRaw.length > 255) return res.status(400).json({ message: 'Full name is too long' });
  const email = emailRaw.toLowerCase();
  const fullName = fullNameRaw || email;
  const existingUser = await storage.getUserByEmail(email);
  if (existingUser) return res.status(201).json(neutralResponse);
  const passwordHash = await bcrypt.hash(passwordRaw, 12);
  const { firstName, lastName } = splitFullName(fullName);
  let user: User;
  try {
    user = await storage.createUser({ email, fullName, firstName, lastName, phone: '', passwordHash });
  } catch (createUserError) {
    const existing = await storage.getUserByEmail(email);
    if (existing) user = existing; else throw createUserError;
  }
  let token: string = '';
  try { token = await emailConfirmationTokenService.createToken(user.id, 24); } catch { return res.status(201).json(neutralResponse); }
  if (!token) return res.status(201).json(neutralResponse);
  const baseUrl = resolveFrontendBaseUrl(req);
  const confirmationUrl = new URL('/auth/verify-email', baseUrl);
  confirmationUrl.searchParams.set('token', token);
  await sendRegistrationEmailWithRetry(email, fullName, confirmationUrl.toString(), user.id);
  return res.status(201).json(neutralResponse);
}));

authRouter.post('/verify-email', asyncHandler(async (req, res, next) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 512) return res.status(400).json({ message: 'Invalid or expired token' });
  const activeToken = await emailConfirmationTokenService.getActiveToken(token);
  if (!activeToken) return res.status(400).json({ message: 'Invalid or expired token' });
  if (activeToken.consumedAt) return res.status(400).json({ message: 'Token already used' });
  const user = await storage.getUserById(activeToken.userId);
  if (!user) return res.status(400).json({ message: 'Invalid token' });
  await storage.confirmUserEmail(user.id);
  await emailConfirmationTokenService.consumeToken(token);
  const safeUser = toPublicUser(user);
  req.logIn(safeUser, (loginError) => {
    if (loginError) return next(loginError);
    void (async () => {
      const updatedUser = await storage.recordUserActivity(user.id);
      const fullUser = updatedUser ?? (await storage.getUser(user.id));
      const finalUser = fullUser ? toPublicUser(fullUser) : safeUser;
      req.user = finalUser;
      const context = await ensureWorkspaceContext(req, finalUser);
      const sessionResponse = buildAuthSessionResponse(finalUser, context);
      res.json(sessionResponse);
    })();
  });
}));

authRouter.post('/resend-confirmation', asyncHandler(async (req, res) => {
  const neutralResponse = { message: 'If this email is registered and not yet confirmed, a new confirmation link has been sent.' };
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!emailRaw || emailRaw.length > 255) return res.status(400).json({ message: 'Email is too long' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return res.status(400).json({ message: 'Invalid email format' });
  const email = emailRaw.toLowerCase();
  const user = await storage.getUserByEmail(email);
  if (!user) return res.status(200).json(neutralResponse);
  if (user.isEmailConfirmed) return res.status(200).json({ message: 'Email is already confirmed.' });
  const lastCreated = await emailConfirmationTokenService.getLastCreatedAt(user.id);
  if (lastCreated && Date.now() - lastCreated.getTime() < 60_000) return res.status(429).json({ message: 'Please wait before requesting another confirmation email' });
  const tokensIn24h = await emailConfirmationTokenService.countTokensLastHours(user.id, 24);
  if (tokensIn24h >= 5) return res.status(429).json({ message: 'Too many confirmation emails requested' });
  const token = await emailConfirmationTokenService.createToken(user.id, 24);
  const baseUrl = resolveFrontendBaseUrl(req);
  const confirmationUrl = new URL('/auth/verify-email', baseUrl);
  confirmationUrl.searchParams.set('token', token);
  await registrationEmailService.sendRegistrationConfirmationEmail(user.email, user.fullName || user.email, confirmationUrl.toString());
  return res.status(200).json({ message: 'A new confirmation link has been sent if the email is not yet confirmed.' });
}));

authRouter.post('/login', authLoginLimiter, (req, res, next) => {
  passport.authenticate('local', (err: unknown, user: PublicUser | false, info?: { message?: string }) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ message: info?.message ?? 'Неверный email или пароль' });
    const isPending = user.status === 'pending_email_confirmation' || user.status === 'PendingEmailConfirmation' || user.isEmailConfirmed === false;
    if (isPending) return res.status(403).json({ error: 'email_not_confirmed', message: 'Please confirm your email before logging in.' });
    req.logIn(user, (loginError) => {
      if (loginError) return next(loginError);
      void (async () => {
        const updatedUser = await storage.recordUserActivity(user.id);
        const fullUser = updatedUser ?? (await storage.getUser(user.id));
        const safeUser = fullUser ? toPublicUser(fullUser) : user;
        req.user = safeUser;
        const context = await ensureWorkspaceContext(req, safeUser);
        const sessionResponse = buildAuthSessionResponse(safeUser, context);
        res.json(sessionResponse);
      })();
    });
  })(req, res, next);
});

authRouter.post('/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    if (req.session) delete req.session.workspaceId;
    res.json({ success: true });
  });
});

// ============================================================================
// Invitation Endpoints
// ============================================================================

/**
 * GET /api/auth/invite/:token
 * Check invitation token and return invitation info
 */
authRouter.get('/invite/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;
  
  if (!token || token.length > 512) {
    return res.json({ valid: false, error: 'INVALID_TOKEN' });
  }

  const invitationData = await getInvitationByToken(token);
  
  if (!invitationData) {
    return res.json({ valid: false, error: 'INVALID_TOKEN' });
  }

  const { invitation, workspace, invitedBy, userExists } = invitationData;
  const validationError = validateInvitation(invitation);

  if (validationError) {
    return res.json({ valid: false, error: validationError });
  }

  res.json({
    valid: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      iconUrl: workspace.iconUrl,
    },
    invitedBy,
    userExists,
  });
}));

/**
 * POST /api/auth/accept-invite
 * Accept invitation for logged-in user
 */
authRouter.post('/accept-invite', asyncHandler(async (req, res, next) => {
  const user = req.user as PublicUser | undefined;
  
  if (!user) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  
  if (!token || token.length > 512) {
    return res.status(400).json({ message: 'Недействительный токен' });
  }

  try {
    const result = await acceptInvitation(token, user.id);
    
    // Update session with new workspace
    if (req.session) {
      req.session.activeWorkspaceId = result.workspaceId;
      req.session.workspaceId = result.workspaceId;
    }

    // Get updated workspace context
    const context = await ensureWorkspaceContext(req, user);
    const sessionResponse = buildAuthSessionResponse(user, context);

    res.json({
      success: true,
      workspace: {
        id: result.workspaceId,
        role: result.role,
      },
      ...sessionResponse,
    });
  } catch (error) {
    if (error instanceof InvitationError) {
      const statusCodes: Record<string, number> = {
        INVALID_TOKEN: 400,
        EXPIRED: 400,
        CANCELLED: 400,
        ALREADY_ACCEPTED: 400,
        ALREADY_MEMBER: 409,
        EMAIL_MISMATCH: 403,
        NOT_FOUND: 404,
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
 * POST /api/auth/complete-invite
 * Complete registration via invitation (for new users)
 */
authRouter.post('/complete-invite', asyncHandler(async (req, res, next) => {
  const completeInviteSchema = z.object({
    token: z.string().min(1).max(512),
    password: z.string()
      .min(8, 'Пароль должен быть не менее 8 символов')
      .max(100, 'Пароль слишком длинный')
      .refine(
        (p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p),
        'Пароль должен содержать буквы и цифры',
      ),
    fullName: z.string()
      .trim()
      .min(1, 'Введите имя')
      .max(255, 'Имя слишком длинное'),
  });

  let payload;
  try {
    payload = completeInviteSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: error.issues[0]?.message ?? 'Некорректные данные',
        details: error.issues,
      });
    }
    throw error;
  }

  // Validate token
  const invitationData = await getInvitationByToken(payload.token);
  
  if (!invitationData) {
    return res.status(400).json({ message: 'Недействительный токен приглашения', code: 'INVALID_TOKEN' });
  }

  const { invitation, workspace } = invitationData;
  const validationError = validateInvitation(invitation);

  if (validationError) {
    const messages: Record<string, string> = {
      ALREADY_ACCEPTED: 'Приглашение уже использовано',
      CANCELLED: 'Приглашение было отменено',
      EXPIRED: 'Срок действия приглашения истёк',
    };
    return res.status(400).json({
      message: messages[validationError] || 'Недействительное приглашение',
      code: validationError,
    });
  }

  // Check if user already exists
  const existingUser = await storage.getUserByEmail(invitation.email);
  if (existingUser) {
    return res.status(409).json({
      message: 'Пользователь с таким email уже существует. Пожалуйста, войдите в систему.',
      code: 'USER_EXISTS',
    });
  }

  // Create user
  const passwordHash = await bcrypt.hash(payload.password, 12);
  const fullName = payload.fullName.trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  let result: { user: User; membership: WorkspaceMember };
  try {
    // Use enterprise method: atomic creation + membership + invitation acceptance
    result = await storage.createUserFromInvitation({
      email: invitation.email,
      fullName,
      firstName,
      lastName,
      phone: '',
      passwordHash,
      workspaceId: invitation.workspaceId,
      role: invitation.role,
      invitationId: invitation.id,
    });
    
    authLogger.info(
      { 
        userId: result.user.id, 
        email: invitation.email, 
        workspaceId: invitation.workspaceId,
        invitationId: invitation.id,
      }, 
      'User created from invitation successfully',
    );
  } catch (createError) {
    authLogger.error({ error: createError, email: invitation.email }, 'Error creating user from invitation');
    
    // Check if user was created by race condition
    const existing = await storage.getUserByEmail(invitation.email);
    if (existing) {
      return res.status(409).json({
        message: 'Пользователь с таким email уже существует',
        code: 'USER_EXISTS',
      });
    }
    
    throw createError;
  }

  const newUser = result.user;

  // Log in user
  const safeUser = toPublicUser(newUser);
  
  req.logIn(safeUser, async (loginError) => {
    if (loginError) {
      return next(loginError);
    }

    // Set workspace in session
    if (req.session) {
      req.session.activeWorkspaceId = invitation.workspaceId;
      req.session.workspaceId = invitation.workspaceId;
    }

    try {
      const context = await ensureWorkspaceContext(req, safeUser);
      const sessionResponse = buildAuthSessionResponse(safeUser, context);
      res.status(201).json(sessionResponse);
    } catch (contextError) {
      authLogger.error({ error: contextError, userId: newUser.id }, 'Failed to get workspace context');
      res.status(201).json({ user: safeUser });
    }
  });
}));

export default authRouter;

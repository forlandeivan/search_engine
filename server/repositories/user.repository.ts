/**
 * User Repository
 * 
 * Handles all user-related database operations.
 * Extracted from storage.ts for better code organization.
 */

import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import {
  users,
  personalApiTokens,
  type User,
  type InsertUser,
  type PersonalApiToken,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('user-repository');

// Types for Google/Yandex OAuth upsert payloads
export interface GoogleUserUpsertPayload {
  googleId: string;
  email: string;
  avatar?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean | null;
}

export interface YandexUserUpsertPayload {
  yandexId: string;
  email: string;
  avatar?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean | null;
}

// Profile normalization helpers
function normalizeProfileString(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function resolveNamesFromProfile(options: {
  emailFallback: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): { fullName: string; firstName: string; lastName: string } {
  const providedFullName = normalizeProfileString(options.fullName);
  const providedFirstName = normalizeProfileString(options.firstName);
  const providedLastName = normalizeProfileString(options.lastName);

  let firstName = providedFirstName;
  let lastName = providedLastName;
  let fullName = providedFullName;

  // Build fullName from first + last if not provided
  if (!fullName && (firstName || lastName)) {
    fullName = [firstName, lastName].filter(Boolean).join(' ');
  }

  // If fullName provided but not first/last, try to split
  if (fullName && !firstName && !lastName) {
    const parts = fullName.split(/\s+/);
    if (parts.length >= 2) {
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      firstName = parts[0] || '';
    }
  }

  // Fallback to email prefix
  if (!fullName) {
    const emailPrefix = options.emailFallback.split('@')[0] || 'User';
    fullName = emailPrefix;
    firstName = emailPrefix;
  }

  return { fullName, firstName, lastName };
}

/**
 * User Repository - handles all user data operations
 */
export const userRepository = {
  /**
   * Get user by ID
   */
  async getById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ?? undefined;
  },

  /**
   * Get user by email
   */
  async getByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user ?? undefined;
  },

  /**
   * Get user by Google ID
   */
  async getByGoogleId(googleId: string): Promise<User | undefined> {
    const trimmedId = googleId.trim();
    if (!trimmedId) {
      return undefined;
    }
    const [user] = await db.select().from(users).where(eq(users.googleId, trimmedId));
    return user ?? undefined;
  },

  /**
   * Get user by Yandex ID
   */
  async getByYandexId(yandexId: string): Promise<User | undefined> {
    const trimmedId = yandexId.trim();
    if (!trimmedId) {
      return undefined;
    }
    const [user] = await db.select().from(users).where(eq(users.yandexId, trimmedId));
    return user ?? undefined;
  },

  /**
   * Create a new user
   */
  async create(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    if (!newUser) {
      throw new Error('Не удалось создать пользователя');
    }
    return newUser;
  },

  /**
   * Create or update user from Google OAuth
   */
  async upsertFromGoogle(
    payload: GoogleUserUpsertPayload,
    ensureWorkspace: (user: User) => Promise<void>,
  ): Promise<User> {
    const googleId = normalizeProfileString(payload.googleId);
    if (!googleId) {
      throw new Error('Отсутствует идентификатор Google');
    }

    const email = normalizeProfileString(payload.email).toLowerCase();
    if (!email) {
      throw new Error('Отсутствует email Google-профиля');
    }

    const avatar = normalizeProfileString(payload.avatar);
    const { fullName, firstName, lastName } = resolveNamesFromProfile({
      emailFallback: email,
      fullName: payload.fullName,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    const requestedEmailVerified = payload.emailVerified;

    // Check by Google ID first
    const [existingByGoogle] = await db.select().from(users).where(eq(users.googleId, googleId));
    if (existingByGoogle) {
      const googleEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByGoogle.googleEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await db
        .update(users)
        .set({
          email,
          fullName: fullName || existingByGoogle.fullName,
          firstName: firstName || existingByGoogle.firstName,
          lastName: lastName || existingByGoogle.lastName,
          googleId,
          googleAvatar: avatar || existingByGoogle.googleAvatar || '',
          googleEmailVerified,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByGoogle.id))
        .returning();

      const resolved = updatedUser ?? existingByGoogle;
      await ensureWorkspace(resolved);
      return resolved;
    }

    // Check by email
    const [existingByEmail] = await db.select().from(users).where(eq(users.email, email));
    if (existingByEmail) {
      const googleEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByEmail.googleEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await db
        .update(users)
        .set({
          googleId,
          googleAvatar: avatar || existingByEmail.googleAvatar || '',
          googleEmailVerified,
          fullName: fullName || existingByEmail.fullName,
          firstName: firstName || existingByEmail.firstName,
          lastName: lastName || existingByEmail.lastName,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByEmail.id))
        .returning();

      const resolved = updatedUser ?? existingByEmail;
      await ensureWorkspace(resolved);
      return resolved;
    }

    // Create new user
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        fullName,
        firstName,
        lastName,
        phone: '',
        passwordHash: null,
        googleId,
        googleAvatar: avatar,
        googleEmailVerified: Boolean(requestedEmailVerified),
      })
      .returning();

    if (!newUser) {
      throw new Error('Не удалось создать пользователя по данным Google');
    }

    await ensureWorkspace(newUser);
    return newUser;
  },

  /**
   * Create or update user from Yandex OAuth
   */
  async upsertFromYandex(
    payload: YandexUserUpsertPayload,
    ensureWorkspace: (user: User) => Promise<void>,
  ): Promise<User> {
    const yandexId = normalizeProfileString(payload.yandexId);
    if (!yandexId) {
      throw new Error('Отсутствует идентификатор Yandex');
    }

    const email = normalizeProfileString(payload.email).toLowerCase();
    if (!email) {
      throw new Error('Отсутствует email Yandex-профиля');
    }

    const avatar = normalizeProfileString(payload.avatar);
    const { fullName, firstName, lastName } = resolveNamesFromProfile({
      emailFallback: email,
      fullName: payload.fullName,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    const requestedEmailVerified = payload.emailVerified;

    // Check by Yandex ID first
    const [existingByYandex] = await db.select().from(users).where(eq(users.yandexId, yandexId));
    if (existingByYandex) {
      const yandexEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByYandex.yandexEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await db
        .update(users)
        .set({
          email,
          fullName: fullName || existingByYandex.fullName,
          firstName: firstName || existingByYandex.firstName,
          lastName: lastName || existingByYandex.lastName,
          yandexId,
          yandexAvatar: avatar || existingByYandex.yandexAvatar || '',
          yandexEmailVerified,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByYandex.id))
        .returning();

      const resolved = updatedUser ?? existingByYandex;
      await ensureWorkspace(resolved);
      return resolved;
    }

    // Check by email
    const [existingByEmail] = await db.select().from(users).where(eq(users.email, email));
    if (existingByEmail) {
      const yandexEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByEmail.yandexEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await db
        .update(users)
        .set({
          yandexId,
          yandexAvatar: avatar || existingByEmail.yandexAvatar || '',
          yandexEmailVerified,
          fullName: fullName || existingByEmail.fullName,
          firstName: firstName || existingByEmail.firstName,
          lastName: lastName || existingByEmail.lastName,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByEmail.id))
        .returning();

      const resolved = updatedUser ?? existingByEmail;
      await ensureWorkspace(resolved);
      return resolved;
    }

    // Create new user
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        fullName,
        firstName,
        lastName,
        phone: '',
        passwordHash: null,
        yandexId,
        yandexAvatar: avatar,
        yandexEmailVerified: Boolean(requestedEmailVerified),
      })
      .returning();

    if (!newUser) {
      throw new Error('Не удалось создать пользователя по данным Yandex');
    }

    await ensureWorkspace(newUser);
    return newUser;
  },

  /**
   * List all users
   */
  async list(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  },

  /**
   * Update user role
   */
  async updateRole(userId: string, role: User['role']): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ role, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  },

  /**
   * Record user activity (update lastActiveAt)
   */
  async recordActivity(
    userId: string,
    ensureWorkspace?: (user: User) => Promise<void>,
  ): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({
        lastActiveAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (updatedUser && ensureWorkspace) {
      await ensureWorkspace(updatedUser);
    }
    return updatedUser ?? undefined;
  },

  /**
   * Confirm user email
   */
  async confirmEmail(userId: string): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({
        isEmailConfirmed: true,
        status: 'active',
        emailConfirmedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  },

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    updates: { firstName: string; lastName: string; phone: string; fullName: string },
  ): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({
        firstName: updates.firstName,
        lastName: updates.lastName,
        phone: updates.phone,
        fullName: updates.fullName,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  },

  /**
   * Update user password
   */
  async updatePassword(userId: string, passwordHash: string): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set({ passwordHash, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  },

  // Personal API Token methods

  /**
   * Create a personal API token for user
   */
  async createPersonalApiToken(
    userId: string,
    token: { hash: string; lastFour: string },
  ): Promise<PersonalApiToken | undefined> {
    const [createdToken] = await db
      .insert(personalApiTokens)
      .values({
        userId,
        tokenHash: token.hash,
        lastFour: token.lastFour,
      })
      .returning();
    return createdToken ?? undefined;
  },

  /**
   * List user's personal API tokens
   */
  async listPersonalApiTokens(userId: string): Promise<PersonalApiToken[]> {
    return await db
      .select()
      .from(personalApiTokens)
      .where(eq(personalApiTokens.userId, userId))
      .orderBy(desc(personalApiTokens.createdAt));
  },

  /**
   * Revoke a personal API token
   */
  async revokePersonalApiToken(
    userId: string,
    tokenId: string,
  ): Promise<PersonalApiToken | undefined> {
    const [updatedToken] = await db
      .update(personalApiTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(personalApiTokens.id, tokenId),
          eq(personalApiTokens.userId, userId),
          isNull(personalApiTokens.revokedAt),
        ),
      )
      .returning();
    return updatedToken ?? undefined;
  },

  /**
   * Set legacy personal API token on user record
   */
  async setPersonalApiToken(
    userId: string,
    token: { hash: string | null; lastFour: string | null; generatedAt?: Date | string | null },
  ): Promise<User | undefined> {
    const generatedAtValue =
      token.generatedAt === undefined
        ? token.hash
          ? sql`CURRENT_TIMESTAMP`
          : null
        : token.generatedAt === null
          ? null
          : new Date(token.generatedAt);

    const [updatedUser] = await db
      .update(users)
      .set({
        personalApiTokenHash: token.hash ?? null,
        personalApiTokenLastFour: token.lastFour ?? null,
        personalApiTokenGeneratedAt: generatedAtValue,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  },

  /**
   * Get user by personal API token hash
   */
  async getByPersonalApiTokenHash(hash: string): Promise<User | undefined> {
    const [result] = await db
      .select({ user: users })
      .from(personalApiTokens)
      .innerJoin(users, eq(personalApiTokens.userId, users.id))
      .where(and(eq(personalApiTokens.tokenHash, hash), isNull(personalApiTokens.revokedAt)))
      .orderBy(desc(personalApiTokens.createdAt))
      .limit(1);

    return result?.user ?? undefined;
  },
};

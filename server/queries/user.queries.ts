/**
 * User Prepared Queries
 * 
 * Prepared statements for frequently used user queries.
 * These are compiled once and reused for better performance.
 */

import { eq, desc, and, isNull } from 'drizzle-orm';
import { users, personalApiTokens } from '@shared/schema';
import { db } from '../db';

/**
 * Get user by ID - prepared statement
 * Used in authentication and session management
 */
export const getUserByIdPrepared = db
  .select()
  .from(users)
  .where(eq(users.id, db.placeholder('userId')))
  .limit(1)
  .prepare('get_user_by_id');

/**
 * Get user by email - prepared statement
 * Used in login and registration
 */
export const getUserByEmailPrepared = db
  .select()
  .from(users)
  .where(eq(users.email, db.placeholder('email')))
  .limit(1)
  .prepare('get_user_by_email');

/**
 * Get user by Google ID - prepared statement
 * Used in Google OAuth flow
 */
export const getUserByGoogleIdPrepared = db
  .select()
  .from(users)
  .where(eq(users.googleId, db.placeholder('googleId')))
  .limit(1)
  .prepare('get_user_by_google_id');

/**
 * Get user by Yandex ID - prepared statement
 * Used in Yandex OAuth flow
 */
export const getUserByYandexIdPrepared = db
  .select()
  .from(users)
  .where(eq(users.yandexId, db.placeholder('yandexId')))
  .limit(1)
  .prepare('get_user_by_yandex_id');

/**
 * Get user by personal API token hash - prepared statement
 * Used in API authentication
 */
export const getUserByApiTokenPrepared = db
  .select({ user: users })
  .from(personalApiTokens)
  .innerJoin(users, eq(personalApiTokens.userId, users.id))
  .where(
    and(
      eq(personalApiTokens.tokenHash, db.placeholder('tokenHash')),
      isNull(personalApiTokens.revokedAt),
    ),
  )
  .orderBy(desc(personalApiTokens.createdAt))
  .limit(1)
  .prepare('get_user_by_api_token');

/**
 * List all users - prepared statement
 * Used in admin panel
 */
export const listUsersPrepared = db
  .select()
  .from(users)
  .orderBy(desc(users.createdAt))
  .prepare('list_users');

// Type-safe execution helpers
export async function getUserById(userId: string) {
  const result = await getUserByIdPrepared.execute({ userId });
  return result[0] ?? undefined;
}

export async function getUserByEmail(email: string) {
  const result = await getUserByEmailPrepared.execute({ email });
  return result[0] ?? undefined;
}

export async function getUserByGoogleId(googleId: string) {
  const trimmedId = googleId.trim();
  if (!trimmedId) return undefined;
  const result = await getUserByGoogleIdPrepared.execute({ googleId: trimmedId });
  return result[0] ?? undefined;
}

export async function getUserByYandexId(yandexId: string) {
  const trimmedId = yandexId.trim();
  if (!trimmedId) return undefined;
  const result = await getUserByYandexIdPrepared.execute({ yandexId: trimmedId });
  return result[0] ?? undefined;
}

export async function getUserByApiToken(tokenHash: string) {
  const result = await getUserByApiTokenPrepared.execute({ tokenHash });
  return result[0]?.user ?? undefined;
}

export async function listUsers() {
  return await listUsersPrepared.execute();
}

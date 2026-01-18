/**
 * Workspace Prepared Queries
 * 
 * Prepared statements for frequently used workspace queries.
 * These are compiled once and reused for better performance.
 */

import { eq, desc, and, sql } from 'drizzle-orm';
import { workspaces, workspaceMembers, users } from '@shared/schema';
import { db } from '../db';

/**
 * Get workspace by ID - prepared statement
 * Used in many workspace operations
 */
export const getWorkspaceByIdPrepared = db
  .select()
  .from(workspaces)
  .where(eq(workspaces.id, sql.placeholder('workspaceId')))
  .limit(1)
  .prepare('get_workspace_by_id');

/**
 * Get workspace membership - prepared statement
 * Used in authorization checks (every request)
 */
export const getWorkspaceMembershipPrepared = db
  .select({
    workspaceId: workspaceMembers.workspaceId,
    userId: workspaceMembers.userId,
    role: workspaceMembers.role,
  })
  .from(workspaceMembers)
  .where(
    and(
      eq(workspaceMembers.userId, sql.placeholder('userId')),
      eq(workspaceMembers.workspaceId, sql.placeholder('workspaceId')),
    ),
  )
  .limit(1)
  .prepare('get_workspace_membership');

/**
 * Check if user is workspace member - prepared statement
 * Used in quick authorization checks
 */
export const isWorkspaceMemberPrepared = db
  .select({ userId: workspaceMembers.userId })
  .from(workspaceMembers)
  .where(
    and(
      eq(workspaceMembers.workspaceId, sql.placeholder('workspaceId')),
      eq(workspaceMembers.userId, sql.placeholder('userId')),
    ),
  )
  .limit(1)
  .prepare('is_workspace_member');

/**
 * List user workspaces with roles - prepared statement
 * Used when loading user's workspace list
 */
export const listUserWorkspacesPrepared = db
  .select({
    workspace: workspaces,
    role: workspaceMembers.role,
  })
  .from(workspaceMembers)
  .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
  .where(eq(workspaceMembers.userId, sql.placeholder('userId')))
  .orderBy(desc(workspaces.createdAt))
  .prepare('list_user_workspaces');

/**
 * List workspace members - prepared statement
 * Used in workspace settings
 */
export const listWorkspaceMembersPrepared = db
  .select({
    member: workspaceMembers,
    user: users,
  })
  .from(workspaceMembers)
  .innerJoin(users, eq(workspaceMembers.userId, users.id))
  .where(eq(workspaceMembers.workspaceId, sql.placeholder('workspaceId')))
  .orderBy(desc(workspaceMembers.createdAt))
  .prepare('list_workspace_members');

// Type-safe execution helpers
export async function getWorkspaceById(workspaceId: string) {
  const result = await getWorkspaceByIdPrepared.execute({ workspaceId });
  return result[0] ?? undefined;
}

export async function getWorkspaceMembership(userId: string, workspaceId: string) {
  const result = await getWorkspaceMembershipPrepared.execute({ userId, workspaceId });
  return result[0] ?? null;
}

export async function isWorkspaceMember(workspaceId: string, userId: string) {
  const result = await isWorkspaceMemberPrepared.execute({ workspaceId, userId });
  return Boolean(result[0]);
}

export async function listUserWorkspaces(userId: string) {
  return await listUserWorkspacesPrepared.execute({ userId });
}

export async function listWorkspaceMembers(workspaceId: string) {
  return await listWorkspaceMembersPrepared.execute({ workspaceId });
}

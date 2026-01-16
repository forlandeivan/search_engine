/**
 * Workspace Repository
 * 
 * Handles all workspace-related database operations.
 * Extracted from storage.ts for better code organization.
 */

import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import {
  workspaces,
  workspaceMembers,
  workspaceMemberRoles,
  users,
  knowledgeBases,
  tariffPlans,
  fileStorageProviders,
  type Workspace,
  type WorkspaceMember,
  type User,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('workspace-repository');

/**
 * Workspace with member role info
 */
export interface WorkspaceWithRole {
  workspace: Workspace;
  role: WorkspaceMember['role'];
}

/**
 * Workspace member with user info
 */
export interface WorkspaceMemberWithUser {
  member: WorkspaceMember;
  user: User;
}

/**
 * Workspace membership info
 */
export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceMember['role'];
}

/**
 * Admin summary for workspace listing
 */
export interface WorkspaceAdminSummary {
  id: string;
  name: string;
  createdAt: Date | null;
  usersCount: number;
  managerFullName: string | null;
  tariffPlanId: string | null;
  tariffPlanCode: string | null;
  tariffPlanName: string | null;
  defaultFileStorageProviderId: string | null;
  defaultFileStorageProviderName: string | null;
}

/**
 * Workspace Repository - handles all workspace data operations
 */
export const workspaceRepository = {
  /**
   * Get workspace by ID
   */
  async getById(id: string): Promise<Workspace | undefined> {
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    return workspace ?? undefined;
  },

  /**
   * Update workspace icon
   */
  async updateIcon(
    workspaceId: string,
    iconUrl: string | null,
    iconKey: string | null = null,
  ): Promise<Workspace | undefined> {
    const [updated] = await db
      .update(workspaces)
      .set({ iconUrl, iconKey, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return updated ?? undefined;
  },

  /**
   * Set workspace storage bucket
   */
  async setStorageBucket(workspaceId: string, bucketName: string): Promise<void> {
    await db
      .update(workspaces)
      .set({ storageBucket: bucketName, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  },

  /**
   * Check if user is a member of workspace
   */
  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    return Boolean(row);
  },

  /**
   * Get workspace membership info
   */
  async getMembership(userId: string, workspaceId: string): Promise<WorkspaceMembership | null> {
    const [row] = await db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
      .limit(1);

    return row ?? null;
  },

  /**
   * Get workspace member
   */
  async getMember(userId: string, workspaceId: string): Promise<WorkspaceMembership | undefined> {
    const membership = await this.getMembership(userId, workspaceId);
    return membership ?? undefined;
  },

  /**
   * List user's workspaces with roles
   */
  async listUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    const rows = await db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(desc(workspaces.createdAt));

    return rows.map((row: { workspace: Workspace; role: WorkspaceMember['role'] }) => ({
      workspace: row.workspace,
      role: row.role,
    }));
  },

  /**
   * Get knowledge base counts for workspaces
   */
  async getKnowledgeBaseCounts(workspaceIds: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (!workspaceIds || workspaceIds.length === 0) {
      return result;
    }

    const workspaceList = [...workspaceIds];

    const rows = await db
      .select({
        workspaceId: knowledgeBases.workspaceId,
        count: sql<number>`COUNT(${knowledgeBases.id})`,
      })
      .from(knowledgeBases)
      .where(inArray(knowledgeBases.workspaceId, workspaceList))
      .groupBy(knowledgeBases.workspaceId);

    for (const row of rows as Array<{ workspaceId: string; count: number }>) {
      result.set(row.workspaceId, Number(row.count ?? 0));
    }

    return result;
  },

  /**
   * Add member to workspace
   */
  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember['role'] = 'user',
  ): Promise<WorkspaceMember | undefined> {
    const normalizedRole = workspaceMemberRoles.includes(role) ? role : 'user';

    // Check if already exists
    const [existing] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [member] = await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: normalizedRole })
      .returning();

    return member ?? undefined;
  },

  /**
   * Update workspace member role
   */
  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember['role'],
  ): Promise<WorkspaceMember | undefined> {
    const normalizedRole = workspaceMemberRoles.includes(role) ? role : 'user';

    const [updated] = await db
      .update(workspaceMembers)
      .set({ role: normalizedRole, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .returning();

    return updated ?? undefined;
  },

  /**
   * List workspace members with user info
   */
  async listMembers(workspaceId: string): Promise<WorkspaceMemberWithUser[]> {
    const rows: Array<{ member: WorkspaceMember; user: User }> = await db
      .select({ member: workspaceMembers, user: users })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(desc(workspaceMembers.createdAt));

    return rows.map((row) => ({ member: row.member, user: row.user }));
  },

  /**
   * Remove member from workspace
   */
  async removeMember(workspaceId: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .returning({ userId: workspaceMembers.userId });

    return deleted.length > 0;
  },

  /**
   * List all workspaces with admin stats
   */
  async listAllWithStats(): Promise<WorkspaceAdminSummary[]> {
    const workspaceRows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdAt: workspaces.createdAt,
        usersCount: sql<number>`COUNT(${workspaceMembers.userId})`,
        tariffPlanId: workspaces.tariffPlanId,
        tariffPlanCode: tariffPlans.code,
        tariffPlanName: tariffPlans.name,
        defaultFileStorageProviderId: workspaces.defaultFileStorageProviderId,
        defaultFileStorageProviderName: fileStorageProviders.name,
      })
      .from(workspaces)
      .leftJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .leftJoin(tariffPlans, eq(tariffPlans.id, workspaces.tariffPlanId))
      .leftJoin(fileStorageProviders, eq(fileStorageProviders.id, workspaces.defaultFileStorageProviderId))
      .groupBy(workspaces.id, tariffPlans.id, fileStorageProviders.id)
      .orderBy(desc(workspaces.createdAt));

    type WorkspaceRow = (typeof workspaceRows)[number];

    // Get managers for workspaces
    const managerRows = await db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        fullName: users.fullName,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(inArray(workspaceMembers.role, ['manager', 'owner']))
      .orderBy(workspaceMembers.workspaceId, workspaceMembers.createdAt);

    const managerByWorkspace = new Map<
      string,
      { fullName: string | null; role: WorkspaceMember['role'] }
    >();
    for (const row of managerRows) {
      const current = managerByWorkspace.get(row.workspaceId);
      if (!current || current.role !== 'manager') {
        managerByWorkspace.set(row.workspaceId, {
          fullName: row.fullName ?? null,
          role: row.role,
        });
      }
    }

    return workspaceRows.map((row: WorkspaceRow): WorkspaceAdminSummary => {
      const manager = managerByWorkspace.get(row.id);
      return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        usersCount: Number(row.usersCount ?? 0),
        managerFullName: manager?.fullName ?? null,
        tariffPlanId: row.tariffPlanId ?? null,
        tariffPlanCode: row.tariffPlanCode ?? null,
        tariffPlanName: row.tariffPlanName ?? null,
        defaultFileStorageProviderId: row.defaultFileStorageProviderId ?? null,
        defaultFileStorageProviderName: row.defaultFileStorageProviderName ?? null,
      };
    });
  },
};

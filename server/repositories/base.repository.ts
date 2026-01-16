/**
 * Base Repository Interface
 * 
 * Defines common patterns for all repositories.
 * Repositories encapsulate data access logic for specific domains.
 */

import { db } from '../db';

// Re-export db for use in repositories
export { db };

/**
 * Base interface for entities with common audit fields
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt?: Date | null;
}

/**
 * Common query options
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
}

/**
 * Result wrapper for paginated queries
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/**
 * Helper to handle optional workspaceId in queries
 */
export function buildWorkspaceCondition(workspaceId?: string | null) {
  return workspaceId ? { workspaceId } : {};
}

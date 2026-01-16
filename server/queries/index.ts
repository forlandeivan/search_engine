/**
 * Prepared Queries Index
 * 
 * Central export point for all prepared statements.
 * 
 * Usage:
 * ```typescript
 * import { queries } from './queries';
 * 
 * const user = await queries.user.getUserById(userId);
 * const workspace = await queries.workspace.getWorkspaceById(workspaceId);
 * ```
 */

import * as userQueries from './user.queries';
import * as workspaceQueries from './workspace.queries';
import * as chatQueries from './chat.queries';
import * as skillQueries from './skill.queries';
import * as knowledgeBaseQueries from './knowledge-base.queries';

export const queries = {
  user: userQueries,
  workspace: workspaceQueries,
  chat: chatQueries,
  skill: skillQueries,
  knowledgeBase: knowledgeBaseQueries,
};

// Direct exports for convenience
export * from './user.queries';
export * from './workspace.queries';
export * from './chat.queries';
export * from './skill.queries';
export * from './knowledge-base.queries';

// Re-export namespaces
export { userQueries, workspaceQueries, chatQueries, skillQueries, knowledgeBaseQueries };

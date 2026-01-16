/**
 * Repositories Index
 * 
 * Central export point for all repository modules.
 * These repositories encapsulate data access logic extracted from storage.ts.
 * 
 * Usage:
 * import { userRepository, workspaceRepository } from './repositories';
 */

// Base repository utilities
export * from './base.repository';

// Domain repositories
export { userRepository } from './user.repository';
export type { GoogleUserUpsertPayload, YandexUserUpsertPayload } from './user.repository';

export { workspaceRepository } from './workspace.repository';
export type {
  WorkspaceWithRole,
  WorkspaceMemberWithUser,
  WorkspaceMembership,
  WorkspaceAdminSummary,
} from './workspace.repository';

export { chatRepository } from './chat.repository';
export type { ChatSessionWithSkill } from './chat.repository';

export { knowledgeBaseRepository } from './knowledge-base.repository';
export type {
  KnowledgeBaseRow,
  KnowledgeChunk,
  KnowledgeBaseAskAiRunRecordInput,
} from './knowledge-base.repository';

export { fileRepository } from './file.repository';

export { skillRepository } from './skill.repository';

export { providerRepository } from './provider.repository';

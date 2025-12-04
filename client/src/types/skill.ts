import type { SkillRagConfig, SkillTranscriptionMode } from "@shared/skills";

export interface Skill {
  id: string;
  workspaceId: string;
  name?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  modelId?: string | null;
  llmProviderConfigId?: string | null;
  collectionName?: string | null;
  isSystem: boolean;
  systemKey?: string | null;
  knowledgeBaseIds?: string[];
  ragConfig: SkillRagConfig;
  onTranscriptionMode: SkillTranscriptionMode;
  onTranscriptionAutoActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPayload {
  name?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  modelId?: string | null;
  llmProviderConfigId?: string | null;
  collectionName?: string | null;
  knowledgeBaseIds?: string[];
  ragConfig?: SkillRagConfig;
  onTranscriptionMode?: SkillTranscriptionMode;
  onTranscriptionAutoActionId?: string | null;
}

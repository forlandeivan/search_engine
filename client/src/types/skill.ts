import type { SkillNoCodeConnection, SkillRagConfig } from "@shared/skills";
import type {
  SkillExecutionMode,
  SkillMode,
  SkillTranscriptionMode,
  SkillTranscriptionFlowMode,
  NoCodeAuthType,
} from "@shared/schema";

export interface Skill {
  id: string;
  workspaceId: string;
  name?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  icon?: string | null;
  modelId?: string | null;
  llmProviderConfigId?: string | null;
  collectionName?: string | null;
  isSystem: boolean;
  systemKey?: string | null;
  status?: "active" | "archived";
  executionMode: SkillExecutionMode;
  mode: SkillMode;
  knowledgeBaseIds?: string[];
  ragConfig?: SkillRagConfig | null;
  transcriptionFlowMode: SkillTranscriptionFlowMode;
  onTranscriptionMode: SkillTranscriptionMode;
  onTranscriptionAutoActionId: string | null;
  createdAt: string;
  updatedAt: string;
  noCodeConnection?: SkillNoCodeConnection;
  contextInputLimit?: number | null;
}

export interface SkillPayload {
  name?: string | null;
  description?: string | null;
  systemPrompt?: string | null;
  icon?: string | null;
  modelId?: string | null;
  llmProviderConfigId?: string | null;
  collectionName?: string | null;
  mode?: SkillMode;
  executionMode?: SkillExecutionMode;
  knowledgeBaseIds?: string[];
  ragConfig?: SkillRagConfig | null;
  transcriptionFlowMode?: SkillTranscriptionFlowMode;
  onTranscriptionMode?: SkillTranscriptionMode;
  onTranscriptionAutoActionId?: string | null;
  noCodeEndpointUrl?: string | null;
  noCodeAuthType?: NoCodeAuthType;
  noCodeBearerToken?: string | null;
  contextInputLimit?: number | null;
}

/**
 * Types for SkillsPage components
 */

import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { ActionDto, SkillActionDto } from "@shared/skills";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import type { Skill } from "@/types/skill";
import type { FileStorageProviderSummary } from "@/types/file-storage-providers";
import type { SkillCallbackTokenResponse } from "@shared/skills";

export type KnowledgeBaseMultiSelectProps = {
  value: string[];
  onChange: (next: string[]) => void;
  knowledgeBases: KnowledgeBaseSummary[];
  disabled?: boolean;
  embeddingProviderName?: string | null;
};

export type SkillActionConfigItem = {
  action: ActionDto;
  skillAction: SkillActionDto | null;
  ui: {
    effectiveLabel: string;
    editable: boolean;
  };
};

export type SkillActionRowState = {
  action: ActionDto;
  skillAction: SkillActionDto | null;
  ui: {
    effectiveLabel: string;
    editable: boolean;
  };
  enabled: boolean;
  enabledPlacements: string[];
  labelOverride: string | null;
  saving: boolean;
  editing: boolean;
  draftLabel: string;
};

export type InfoTooltipIconProps = {
  text: string;
};

export type SkillActionsPreviewProps = {
  skillId: string;
  canEdit?: boolean;
};

export type LlmSelectionOption = {
  key: string;
  label: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelDisplayName: string;
  costLevel: "FREE" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  providerIsActive: boolean;
  disabled: boolean;
  catalogModel?: unknown | null;
};

export type SkillFormProps = {
  knowledgeBases: KnowledgeBaseSummary[];
  embeddingProviders: PublicEmbeddingProvider[];
  isEmbeddingProvidersLoading: boolean;
  fileStorageProviders: FileStorageProviderSummary[];
  workspaceDefaultFileStorageProvider: FileStorageProviderSummary | null;
  isFileStorageProvidersLoading?: boolean;
  fileStorageProvidersError?: unknown;
  hasSkillFiles?: boolean;
  isSkillFilesReady?: boolean;
  llmOptions: LlmSelectionOption[];
  onSubmit: (values: unknown) => void | Promise<void>;
  isSubmitting: boolean;
  skill?: Skill | null;
  allowNoCodeFlow?: boolean;
  getIconComponent: (name: string | null | undefined, className?: string) => JSX.Element | null;
  hideHeader?: boolean;
  isOpen?: boolean;
  activeTab?: "main" | "transcription" | "actions";
  onTabChange?: (tab: "main" | "transcription" | "actions") => void;
  onGenerateCallbackToken?: () => Promise<SkillCallbackTokenResponse | null>;
  isGeneratingCallbackToken?: boolean;
  onSkillPatched?: (skill: Skill) => void;
  onEnsureNoCodeMode?: () => Promise<void>;
};

export type SkillSettingsTab = "main" | "transcription" | "actions";

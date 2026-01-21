import { z } from "zod";
import {
  skillExecutionModes,
  skillModes,
  skillRagModes,
  skillTranscriptionModes,
  skillTranscriptionFlowModes,
  noCodeAuthTypes,
} from "./schema";
import type {
  SkillExecutionMode,
  SkillMode,
  SkillRagMode,
  SkillTranscriptionMode,
  SkillTranscriptionFlowMode,
  NoCodeAuthType,
} from "./schema";

const optionalString = (limit: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .refine((value) => {
      if (value === null || value === undefined) {
        return true;
      }
      return value.length <= limit;
    }, `Длина поля не должна превышать ${limit} символов`);

const optionalText = (limit: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .refine((value) => {
      if (value === null || value === undefined) {
        return true;
      }
      return value.length <= limit;
    }, `Длина поля не должна превышать ${limit} символов`);

const knowledgeBaseIdSchema = z.string().min(1);

const ragConfigInputSchema = z.object({
  mode: z.enum(skillRagModes).optional(),
  collectionIds: z.array(z.string().min(1)).optional(),
  topK: z.number().int().min(1).max(50).nullable().optional(),
  minScore: z.number().min(0).max(1).nullable().optional(),
  maxContextTokens: z.number().int().min(500).max(20000).nullable().optional(),
  showSources: z.boolean().nullable().optional(),
  historyMessagesLimit: z.number().int().min(0).max(20).nullable().optional(),
  historyCharsLimit: z.number().int().min(0).max(50000).nullable().optional(),
  bm25Weight: z.number().min(0).max(1).nullable().optional(),
  bm25Limit: z.number().int().min(1).max(50).nullable().optional(),
  vectorWeight: z.number().min(0).max(1).nullable().optional(),
  vectorLimit: z.number().int().min(1).max(50).nullable().optional(),
  embeddingProviderId: optionalString(255),
  llmTemperature: z.number().min(0).max(2).nullable().optional(),
  llmMaxTokens: z.number().int().min(16).max(4096).nullable().optional(),
  llmResponseFormat: z.enum(["text", "markdown", "html"]).nullable().optional(),
});

const noCodeEndpointUrlSchema = z
  .union([z.string().url({ message: "Некорректный URL" }), z.literal(""), z.null()])
  .optional()
  .refine(
    (value) =>
      value === undefined ||
      value === "" ||
      value === null ||
      value.startsWith("http://") ||
      value.startsWith("https://"),
    "Разрешены только http/https URL",
  );

const noCodeBearerTokenSchema = z.string().max(4096, "Не более 4096 символов").optional().or(z.literal(""));
const contextInputLimitSchema = z.number().int().min(100).max(50000).nullable().optional();

const skillEditableFieldsSchema = z.object({
  name: optionalString(200),
  description: optionalText(4000),
  systemPrompt: optionalText(20000),
  modelId: optionalString(200),
  llmProviderConfigId: optionalString(200),
  collectionName: optionalString(200),
  executionMode: z.enum(skillExecutionModes).optional(),
  mode: z.enum(skillModes).optional(),
  knowledgeBaseIds: z.array(knowledgeBaseIdSchema).optional(),
  ragConfig: ragConfigInputSchema.optional(),
  icon: optionalString(100),
  onTranscriptionMode: z.enum(skillTranscriptionModes).optional(),
  onTranscriptionAutoActionId: optionalString(200),
  transcriptionFlowMode: z.enum(skillTranscriptionFlowModes).optional(),
  noCodeEndpointUrl: noCodeEndpointUrlSchema.optional(),
  noCodeFileEventsUrl: noCodeEndpointUrlSchema.optional(),
  noCodeAuthType: z.enum(noCodeAuthTypes).optional(),
  noCodeBearerToken: noCodeBearerTokenSchema.optional(),
  noCodeFileStorageProviderId: optionalString(200),
  contextInputLimit: contextInputLimitSchema,
});

export const createSkillSchema = skillEditableFieldsSchema;
export const updateSkillSchema = skillEditableFieldsSchema;

export type CreateSkillPayload = z.infer<typeof createSkillSchema>;
export type UpdateSkillPayload = z.infer<typeof updateSkillSchema>;

export type SkillNoCodeConnection = {
  endpointUrl: string | null;
  fileEventsUrl: string | null;
  fileStorageProviderId: string | null;
  selectedFileStorageProviderId?: string | null;
  effectiveFileStorageProvider?: {
    id: string;
    name: string;
    baseUrl: string;
    authType: NoCodeAuthType;
  } | null;
  effectiveFileStorageProviderSource?: "skill" | "workspace_default" | "none";
  authType: NoCodeAuthType;
  tokenIsSet: boolean;
  callbackTokenIsSet: boolean;
  callbackTokenLastRotatedAt: string | null;
  callbackTokenLastFour: string | null;
  callbackKey: string | null;
};

export type SkillDto = {
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
  executionMode: SkillExecutionMode;
  status: "active" | "archived";
  mode: SkillMode;
  knowledgeBaseIds?: string[];
  ragConfig: SkillRagConfig;
  transcriptionFlowMode: SkillTranscriptionFlowMode;
  onTranscriptionMode: SkillTranscriptionMode;
  onTranscriptionAutoActionId: string | null;
  icon?: string | null;
  noCodeConnection: SkillNoCodeConnection;
  contextInputLimit: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillRagConfig = {
  mode: SkillRagMode;
  collectionIds: string[];
  topK: number;
  minScore: number;
  maxContextTokens: number | null;
  showSources: boolean;
  historyMessagesLimit: number | null;
  historyCharsLimit: number | null;
  bm25Weight: number | null;
  bm25Limit: number | null;
  vectorWeight: number | null;
  vectorLimit: number | null;
  embeddingProviderId: string | null;
  llmTemperature: number | null;
  llmMaxTokens: number | null;
  llmResponseFormat: "text" | "markdown" | "html" | null;
};

export type SkillResponse = {
  skill: SkillDto;
};

export type SkillListResponse = {
  skills: SkillDto[];
};

export type SkillCallbackTokenResponse = {
  token: string;
  lastFour: string;
  rotatedAt: string;
  skill: SkillDto;
};

// Actions domain
export const actionScopes = ["system", "workspace"] as const;
export type ActionScope = (typeof actionScopes)[number];

export const actionTargets = ["transcript", "message", "selection", "conversation"] as const;
export type ActionTarget = (typeof actionTargets)[number];

export const actionPlacements = ["canvas", "chat_message", "chat_toolbar"] as const;
export type ActionPlacement = (typeof actionPlacements)[number];

export const actionInputTypes = ["full_transcript", "full_text", "selection", "message_text"] as const;
export type ActionInputType = (typeof actionInputTypes)[number];

export const actionOutputModes = ["replace_text", "new_version", "new_message", "document"] as const;
export type ActionOutputMode = (typeof actionOutputModes)[number];

export type ActionDto = {
  id: string;
  scope: ActionScope;
  workspaceId: string | null;
  label: string;
  description: string | null;
  target: ActionTarget;
  placements: ActionPlacement[];
  promptTemplate: string;
  inputType: ActionInputType;
  outputMode: ActionOutputMode;
  llmConfigId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type SkillActionDto = {
  id: string;
  skillId: string;
  actionId: string;
  enabled: boolean;
  enabledPlacements: ActionPlacement[];
  labelOverride: string | null;
  createdAt: string;
  updatedAt: string;
};

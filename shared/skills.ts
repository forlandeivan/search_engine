import { z } from "zod";
import { skillRagModes } from "./schema";
import type { SkillRagMode } from "./schema";

const optionalString = (limit: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .refine((value) => {
      if (value === null || value === undefined) {
        return true;
      }
      return value.length <= limit;
    }, `Превышена максимальная длина ${limit} символов`);

const optionalText = (limit: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .refine((value) => {
      if (value === null || value === undefined) {
        return true;
      }
      return value.length <= limit;
    }, `Превышена максимальная длина ${limit} символов`);

const knowledgeBaseIdSchema = z.string().min(1);

const ragConfigInputSchema = z.object({
  mode: z.enum(skillRagModes).optional(),
  collectionIds: z.array(z.string().min(1)).optional(),
  topK: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(0).max(1).optional(),
  maxContextTokens: z.number().int().min(500).max(20000).optional(),
  showSources: z.boolean().optional(),
  bm25Weight: z.number().min(0).max(1).optional(),
  bm25Limit: z.number().int().min(1).max(50).optional(),
  vectorWeight: z.number().min(0).max(1).optional(),
  vectorLimit: z.number().int().min(1).max(50).optional(),
  embeddingProviderId: optionalString(255),
  llmTemperature: z.number().min(0).max(2).optional(),
  llmMaxTokens: z.number().int().min(16).max(4096).optional(),
  llmResponseFormat: z.enum(["text", "markdown", "html"]).optional(),
});

const skillEditableFieldsSchema = z.object({
  name: optionalString(200),
  description: optionalText(4000),
  systemPrompt: optionalText(20000),
  modelId: optionalString(200),
  llmProviderConfigId: optionalString(200),
  collectionName: optionalString(200),
  knowledgeBaseIds: z.array(knowledgeBaseIdSchema).optional(),
  ragConfig: ragConfigInputSchema.optional(),
});

export const createSkillSchema = skillEditableFieldsSchema;
export const updateSkillSchema = skillEditableFieldsSchema;

export type CreateSkillPayload = z.infer<typeof createSkillSchema>;
export type UpdateSkillPayload = z.infer<typeof updateSkillSchema>;

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
  knowledgeBaseIds?: string[];
  ragConfig: SkillRagConfig;
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

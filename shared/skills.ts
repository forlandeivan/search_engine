import { z } from "zod";
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

const skillEditableFieldsSchema = z.object({
  name: optionalString(200),
  description: optionalText(4000),
  systemPrompt: optionalText(20000),
  modelId: optionalString(200),
  llmProviderConfigId: optionalString(200),
  collectionName: optionalString(200),
  knowledgeBaseIds: z.array(knowledgeBaseIdSchema).optional(),
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
  knowledgeBaseIds?: string[];
  ragMode: SkillRagMode;
  ragCollectionIds: string[];
  ragTopK: number;
  ragMinScore: number;
  ragMaxContextTokens: number | null;
  ragShowSources: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SkillResponse = {
  skill: SkillDto;
};

export type SkillListResponse = {
  skills: SkillDto[];
};

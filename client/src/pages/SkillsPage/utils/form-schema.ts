/**
 * Form schema and utilities for SkillsPage
 */

import { z } from "zod";
import type { PublicModel } from "@/hooks/useModels";
import { WORKSPACE_DEFAULT_PROVIDER_VALUE } from "../constants";

export const skillFormSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(200, "Не более 200 символов"),
  description: z
    .string()
    .max(4000, "Не более 4000 символов")
    .optional()
    .or(z.literal("")),
  executionMode: z.enum(["standard", "no_code"]).default("standard"),
  mode: z.enum(["rag", "llm"]).default("rag"),
  knowledgeBaseIds: z.array(z.string()).default([]),
  llmKey: z.string().min(1, "Выберите конфиг LLM"),
  llmTemperature: z.string().optional().or(z.literal("")),
  llmMaxTokens: z.string().optional().or(z.literal("")),
  systemPrompt: z
    .string()
    .max(20000, "Не более 20000 символов")
    .optional()
    .or(z.literal("")),
  icon: z.string().optional().or(z.literal("")),
  transcriptionFlowMode: z.enum(["standard", "no_code"]).default("standard"),
  onTranscriptionMode: z.enum(["raw_only", "auto_action"]),
  onTranscriptionAutoActionId: z.string().optional().or(z.literal("")),
  noCodeEndpointUrl: z
    .string()
    .url({ message: "Некорректный URL" })
    .optional()
    .or(z.literal(""))
    .refine(
      (value) =>
        value === undefined ||
        value === "" ||
        value.startsWith("http://") ||
        value.startsWith("https://"),
      { message: "Разрешены только http/https URL" },
    ),
  noCodeAuthType: z.enum(["none", "bearer"]).default("none"),
  noCodeBearerToken: z.string().optional().or(z.literal("")),
  noCodeBearerTokenAction: z.enum(["keep", "replace", "clear"]).default("replace"),
  noCodeFileStorageProviderId: z.string().optional().or(z.literal("")).nullable(),
  ragShowSources: z.boolean().default(true),
  ragHistoryMessagesLimit: z.number().int().min(0).max(20).default(6),
  ragHistoryCharsLimit: z.number().int().min(0).max(50000).default(4000),
  ragEnableQueryRewriting: z.boolean().default(true),
  ragQueryRewriteModel: z.string().max(200).optional().or(z.literal("")),
  ragEnableContextCaching: z.boolean().default(false),
  ragContextCacheTtlSeconds: z.number().int().min(60).max(1800).default(300), // от 1 минуты до 30 минут
});

export type SkillFormValues = z.infer<typeof skillFormSchema>;

export const buildLlmKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

export const catalogModelMap = (models: PublicModel[]) => new Map(models.map((m) => [m.key, m]));

export const defaultFormValues: SkillFormValues = {
  name: "",
  description: "",
  executionMode: "standard",
  mode: "llm",
  knowledgeBaseIds: [],
  llmKey: "",
  llmTemperature: "",
  llmMaxTokens: "",
  systemPrompt: "",
  icon: "",
  transcriptionFlowMode: "standard",
  onTranscriptionMode: "raw_only",
  onTranscriptionAutoActionId: "",
  noCodeEndpointUrl: "",
  noCodeFileStorageProviderId: WORKSPACE_DEFAULT_PROVIDER_VALUE,
  noCodeAuthType: "none",
  noCodeBearerToken: "",
  noCodeBearerTokenAction: "replace",
  ragShowSources: true,
  ragHistoryMessagesLimit: 6,
  ragHistoryCharsLimit: 4000,
  ragEnableQueryRewriting: true,
  ragQueryRewriteModel: "",
  ragEnableContextCaching: false,
  ragContextCacheTtlSeconds: 300,
};

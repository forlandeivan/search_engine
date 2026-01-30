/**
 * Utils for SkillsPage components
 */

import { z } from "zod";

export type SkillFormValues = {
  name: string;
  description: string | null;
  systemKey: string | null;
  systemPrompt: string | null;
  icon: string | null;
  llmSelection: string;
  llmKey: string;
  llmTemperature: number | null;
  llmMaxTokens: number | null;
  collectionName: string | null;
  knowledgeBaseIds: string[];
  executionMode: "standard" | "no_code";
  noCodeEndpointUrl: string | null;
  noCodeFileStorageProviderId: string | null;
  noCodeAuthType: "none" | "bearer";
  noCodeBearerToken: string | null;
  noCodeBearerTokenAction: "keep" | "clear" | "new" | "replace";
  contextInputLimit: number | null;
  transcriptionFlowMode: "standard" | "no_code";
  asrProviderId: string | null;
  onTranscriptionMode: "raw_only" | "auto_action";
  onTranscriptionAutoActionId: string | null;
  status: "active" | "archived";
  sharedChatFiles: boolean;
  ragSettings: {
    enabled: boolean;
    topK: number | null;
    similarityThreshold: number | null;
    rerankingEnabled: boolean;
    rerankingTopN: number | null;
    hybridSearchEnabled: boolean;
    hybridSearchAlpha: number | null;
    contextCachingEnabled: boolean;
    queryRewritingEnabled: boolean;
    queryRewritingPrompt: string | null;
    historyEnabled: boolean;
    historyMaxMessages: number | null;
  };
};

export const skillFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable(),
  systemKey: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  icon: z.string().nullable(),
  llmSelection: z.string(),
  llmKey: z.string(),
  llmTemperature: z.number().nullable(),
  llmMaxTokens: z.number().nullable(),
  collectionName: z.string().nullable(),
  knowledgeBaseIds: z.array(z.string()),
  executionMode: z.enum(["standard", "no_code"]),
  noCodeEndpointUrl: z.string().nullable(),
  noCodeFileStorageProviderId: z.string().nullable(),
  noCodeAuthType: z.enum(["none", "bearer"]),
  noCodeBearerToken: z.string().nullable(),
  noCodeBearerTokenAction: z.enum(["keep", "clear", "new", "replace"]),
  contextInputLimit: z.number().nullable(),
  transcriptionFlowMode: z.enum(["standard", "no_code"]),
  asrProviderId: z.string().nullable(),
  onTranscriptionMode: z.enum(["raw_only", "auto_action"]),
  onTranscriptionAutoActionId: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  sharedChatFiles: z.boolean(),
  ragSettings: z.object({
    enabled: z.boolean(),
    topK: z.number().nullable(),
    similarityThreshold: z.number().nullable(),
    rerankingEnabled: z.boolean(),
    rerankingTopN: z.number().nullable(),
    hybridSearchEnabled: z.boolean(),
    hybridSearchAlpha: z.number().nullable(),
    contextCachingEnabled: z.boolean(),
    queryRewritingEnabled: z.boolean(),
    queryRewritingPrompt: z.string().nullable(),
    historyEnabled: z.boolean(),
    historyMaxMessages: z.number().nullable(),
  }),
});

export const defaultFormValues: SkillFormValues = {
  name: "",
  description: null,
  systemKey: null,
  systemPrompt: null,
  icon: null,
  llmSelection: "",
  llmKey: "",
  llmTemperature: null,
  llmMaxTokens: null,
  collectionName: null,
  knowledgeBaseIds: [],
  executionMode: "standard",
  noCodeEndpointUrl: null,
  noCodeFileStorageProviderId: null,
  noCodeAuthType: "none",
  noCodeBearerToken: null,
  noCodeBearerTokenAction: "keep",
  contextInputLimit: null,
  transcriptionFlowMode: "standard",
  asrProviderId: null,
  onTranscriptionMode: "raw_only",
  onTranscriptionAutoActionId: null,
  status: "active",
  sharedChatFiles: false,
  ragSettings: {
    enabled: false,
    topK: null,
    similarityThreshold: null,
    rerankingEnabled: false,
    rerankingTopN: null,
    hybridSearchEnabled: false,
    hybridSearchAlpha: null,
    contextCachingEnabled: false,
    queryRewritingEnabled: false,
    queryRewritingPrompt: null,
    historyEnabled: false,
    historyMaxMessages: null,
  },
};

export function buildLlmKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export const catalogModelMap = new Map();

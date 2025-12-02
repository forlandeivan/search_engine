import { storage } from "./storage";
import type { SkillDto } from "@shared/skills";
import type { ActionDto } from "@shared/skills";
import type { LlmProvider } from "@shared/schema";

export class LlmConfigNotFoundError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigNotFoundError";
  }
}

export async function resolveLlmConfigForAction(
  skill: SkillDto,
  action: ActionDto,
): Promise<LlmProvider> {
  // 1) Явный конфиг в Action
  if (action.llmConfigId) {
    const cfg = await storage.getLlmProvider(action.llmConfigId, skill.workspaceId);
    if (!cfg) {
      throw new LlmConfigNotFoundError("LLM config on action not found or not accessible");
    }
    return cfg;
  }

  // 2) Конфиг на Skill
  if (skill.llmProviderConfigId) {
    const cfg = await storage.getLlmProvider(skill.llmProviderConfigId, skill.workspaceId);
    if (cfg) return cfg;
  }

  // 3) Конфиг на Workspace: используем UnicaChatConfig, если есть
  const workspaceConfig = await storage.getUnicaChatConfig?.();
  if (workspaceConfig?.llmProviderConfigId) {
    const cfg = await storage.getLlmProvider(workspaceConfig.llmProviderConfigId, skill.workspaceId);
    if (cfg) return cfg;
  }

  throw new LlmConfigNotFoundError("LLM config not resolved (action/skill/workspace/default)");
}

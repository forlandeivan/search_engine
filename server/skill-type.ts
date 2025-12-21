import type { SkillDto } from "@shared/skills";
import { UNICA_CHAT_SYSTEM_KEY } from "./skills";

export type SkillLike =
  | Pick<SkillDto, "isSystem" | "systemKey" | "mode" | "knowledgeBaseIds" | "ragConfig">
  | {
      isSystem?: boolean | null;
      systemKey?: string | null;
      mode?: string | null;
      knowledgeBaseIds?: string[] | null;
      ragConfig?: { collectionIds?: string[] | null } | null;
    };

export function isUnicaChatSkill(skill: SkillLike | null | undefined): boolean {
  return Boolean(skill?.isSystem) && skill?.systemKey === UNICA_CHAT_SYSTEM_KEY;
}

export function isRagSkill(skill: SkillLike | null | undefined): boolean {
  if (isUnicaChatSkill(skill)) return false;
  const hasKnowledgeBases = Array.isArray(skill?.knowledgeBaseIds) && skill.knowledgeBaseIds.length > 0;
  const hasCollections =
    Array.isArray(skill?.ragConfig?.collectionIds) && (skill?.ragConfig?.collectionIds?.length ?? 0) > 0;
  if (hasKnowledgeBases || hasCollections) {
    return true;
  }
  if ("knowledgeBaseIds" in (skill ?? {}) || "ragConfig" in (skill ?? {})) {
    return false;
  }
  const mode = (skill as SkillDto | undefined)?.mode ?? (skill as any)?.mode;
  return mode !== "llm";
}

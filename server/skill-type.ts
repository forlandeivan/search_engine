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
  const mode = ("mode" in skill && typeof skill.mode === "string" ? skill.mode : null) ?? (skill as SkillDto | undefined)?.mode ?? null;
  return mode === "rag";
}

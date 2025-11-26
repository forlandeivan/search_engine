import type { SkillDto } from "@shared/skills";
import { UNICA_CHAT_SYSTEM_KEY } from "./skills";

export type SkillLike = Pick<SkillDto, "isSystem" | "systemKey"> | {
  isSystem?: boolean | null;
  systemKey?: string | null;
};

export function isUnicaChatSkill(skill: SkillLike | null | undefined): boolean {
  return Boolean(skill?.isSystem) && skill?.systemKey === UNICA_CHAT_SYSTEM_KEY;
}

export function isRagSkill(skill: SkillLike | null | undefined): boolean {
  return !isUnicaChatSkill(skill);
}

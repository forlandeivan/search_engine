import type { SkillDto } from "@shared/skills";
import { UNICA_CHAT_SYSTEM_KEY } from "./skills";
import fs from "fs";
import path from "path";

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
  const mode = (skill as SkillDto | undefined)?.mode ?? (skill as any)?.mode;
  const result = mode === "rag";
  try {
    const timestamp = new Date().toISOString();
    const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
    fs.appendFileSync(logFile, `[${timestamp}] [isRagSkill] skillId=${(skill as any)?.id ?? 'unknown'}, mode=${mode}, isRag=${result}\n`, "utf-8");
  } catch {}
  console.log(`[isRagSkill] skillId=${(skill as any)?.id ?? 'unknown'}, mode=${mode}, isRag=${result}`);
  return result;
}

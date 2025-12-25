import { sql } from "drizzle-orm";
import type { ActionPlacement, SkillActionDto } from "@shared/skills";
import { db } from "./db";
import { actionsRepository } from "./actions";
import { getSkillById } from "./skills";

function toPgArray(arr: string[]): string {
  if (!arr || arr.length === 0) return "{}";
  const escaped = arr.map(s => `"${s.replace(/"/g, '\\"')}"`);
  return `{${escaped.join(",")}}`;
}

type SkillActionRow = {
  id: string;
  skill_id: string;
  action_id: string;
  enabled: boolean;
  enabled_placements: string[] | null;
  label_override: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SkillActionUpsertPayload = {
  enabled: boolean;
  enabledPlacements: ActionPlacement[];
  labelOverride?: string | null;
};

function mapSkillActionRow(row: SkillActionRow): SkillActionDto {
  return {
    id: row.id,
    skillId: row.skill_id,
    actionId: row.action_id,
    enabled: row.enabled,
    enabledPlacements: (row.enabled_placements ?? []) as ActionPlacement[],
    labelOverride: row.label_override,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function getById(id: string): Promise<SkillActionDto | null> {
  const result = await db.execute(sql`SELECT * FROM "skill_actions" WHERE "id" = ${id} LIMIT 1`);
  const row = (result as any)?.rows?.[0] as SkillActionRow | undefined;
  return row ? mapSkillActionRow(row) : null;
}

async function listForSkill(skillId: string): Promise<SkillActionDto[]> {
  const result = await db.execute(
    sql`SELECT * FROM "skill_actions" WHERE "skill_id" = ${skillId} ORDER BY "created_at" DESC`,
  );
  const rows = ((result as any)?.rows ?? []) as SkillActionRow[];
  console.log("[skill-actions] listForSkill raw rows:", JSON.stringify(rows, null, 2));
  return rows.map(mapSkillActionRow);
}

async function getForSkillAndAction(skillId: string, actionId: string): Promise<SkillActionDto | null> {
  const result = await db.execute(
    sql`
      SELECT * FROM "skill_actions"
      WHERE "skill_id" = ${skillId} AND "action_id" = ${actionId}
      LIMIT 1
    `,
  );
  const row = (result as any)?.rows?.[0] as SkillActionRow | undefined;
  return row ? mapSkillActionRow(row) : null;
}

async function upsertForSkill(
  workspaceId: string,
  skillId: string,
  actionId: string,
  payload: SkillActionUpsertPayload,
): Promise<SkillActionDto> {
  const skill = await getSkillById(workspaceId, skillId);
  if (!skill) {
    throw new Error("Skill not found or does not belong to workspace");
  }

  const action = await actionsRepository.getById(actionId);
  if (!action) {
    throw new Error("Action not found");
  }

  if (action.scope === "workspace" && action.workspaceId !== skill.workspaceId) {
    throw new Error("Cannot attach action from another workspace");
  }
  if (action.scope === "system" && action.workspaceId !== null) {
    throw new Error("Invalid system action configuration");
  }

  const placementsArray = toPgArray(payload.enabledPlacements);
  const result = await db.execute(
    sql`
      INSERT INTO "skill_actions" (
        "skill_id", "action_id", "workspace_id", "enabled", "enabled_placements", "label_override"
      ) VALUES (
        ${skillId}, ${actionId}, ${workspaceId}, ${payload.enabled},
        ${placementsArray}::text[], ${payload.labelOverride ?? null}
      )
      ON CONFLICT ("skill_id", "action_id") DO UPDATE SET
        "enabled" = EXCLUDED."enabled",
        "enabled_placements" = EXCLUDED."enabled_placements",
        "label_override" = EXCLUDED."label_override",
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING *
    `,
  );

  const row = (result as any)?.rows?.[0] as SkillActionRow | undefined;
  if (!row) {
    throw new Error("Failed to upsert skill action");
  }
  return mapSkillActionRow(row);
}

async function deleteForSkill(skillId: string, actionId: string): Promise<void> {
  await db.execute(
    sql`
      DELETE FROM "skill_actions"
      WHERE "skill_id" = ${skillId} AND "action_id" = ${actionId}
    `,
  );
}

export const skillActionsRepository = {
  getById,
  listForSkill,
  getForSkillAndAction,
  upsertForSkill,
  deleteForSkill,
};

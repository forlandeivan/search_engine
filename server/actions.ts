import { sql } from "drizzle-orm";
import { db } from "./db";
import type {
  ActionDto,
  ActionScope,
  ActionTarget,
  ActionPlacement,
  ActionInputType,
  ActionOutputMode,
} from "@shared/skills";

type CreateActionPayload = {
  label: string;
  description?: string | null;
  target: ActionTarget;
  placements: ActionPlacement[];
  promptTemplate: string;
  inputType: ActionInputType;
  outputMode: ActionOutputMode;
  llmConfigId?: string | null;
};

type UpdateActionPayload = Partial<CreateActionPayload>;

type ActionRow = {
  id: string;
  scope: string;
  workspace_id: string | null;
  label: string;
  description: string | null;
  target: string;
  placements: string[] | null;
  prompt_template: string;
  input_type: string;
  output_mode: string;
  llm_config_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

function mapActionRow(row: ActionRow): ActionDto {
  return {
    id: row.id,
    scope: row.scope as ActionScope,
    workspaceId: row.workspace_id,
    label: row.label,
    description: row.description,
    target: row.target as ActionTarget,
    placements: (row.placements ?? []) as ActionPlacement[],
    promptTemplate: row.prompt_template,
    inputType: row.input_type as ActionInputType,
    outputMode: row.output_mode as ActionOutputMode,
    llmConfigId: row.llm_config_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  };
}

async function getById(actionId: string): Promise<ActionDto | null> {
  const result = await db.execute<ActionRow>(
    sql`SELECT * FROM "actions" WHERE "id" = ${actionId} AND "deleted_at" IS NULL LIMIT 1`,
  );
  const row = result.rows?.[0];
  return row ? mapActionRow(row) : null;
}

async function getByIdForWorkspace(workspaceId: string, actionId: string): Promise<ActionDto | null> {
  const result = await db.execute<ActionRow>(
    sql`
      SELECT * FROM "actions"
      WHERE "id" = ${actionId}
        AND "deleted_at" IS NULL
        AND (
          ("scope" = 'workspace' AND "workspace_id" = ${workspaceId})
          OR ("scope" = 'system')
        )
      LIMIT 1
    `,
  );
  const row = result.rows?.[0];
  return row ? mapActionRow(row) : null;
}

async function listForWorkspace(
  workspaceId: string,
  options: { includeSystem?: boolean } = {},
): Promise<ActionDto[]> {
  const includeSystem = options.includeSystem ?? false;
  const result = await db.execute<ActionRow>(
    sql`
      SELECT * FROM "actions"
      WHERE "deleted_at" IS NULL
        AND (
          ("scope" = 'workspace' AND "workspace_id" = ${workspaceId})
          ${includeSystem ? sql`OR ("scope" = 'system')` : sql``}
        )
      ORDER BY "created_at" DESC
    `,
  );
  return (result.rows ?? []).map(mapActionRow);
}

async function createWorkspaceAction(
  workspaceId: string,
  payload: CreateActionPayload,
): Promise<ActionDto> {
  const result = await db.execute<ActionRow>(
    sql`
      INSERT INTO "actions" (
        "scope", "workspace_id", "label", "description", "target", "placements",
        "prompt_template", "input_type", "output_mode", "llm_config_id"
      ) VALUES (
        'workspace', ${workspaceId}, ${payload.label}, ${payload.description ?? null},
        ${payload.target}, ${payload.placements},
        ${payload.promptTemplate}, ${payload.inputType}, ${payload.outputMode}, ${payload.llmConfigId ?? null}
      )
      RETURNING *
    `,
  );
  const row = result.rows?.[0];
  if (!row) {
    throw new Error("Failed to create action");
  }
  return mapActionRow(row);
}

async function updateWorkspaceAction(
  workspaceId: string,
  actionId: string,
  patch: UpdateActionPayload,
): Promise<ActionDto> {
  const existing = await getById(actionId);
  if (!existing) {
    throw new Error("Action not found");
  }
  if (existing.scope === "system") {
    throw new Error("Cannot modify system action via workspace API");
  }
  if (existing.workspaceId !== workspaceId) {
    throw new Error("Cannot modify action from another workspace");
  }

  const updated = await db.execute<ActionRow>(
    sql`
      UPDATE "actions"
      SET
        "label" = COALESCE(${patch.label}, "label"),
        "description" = COALESCE(${patch.description ?? null}, "description"),
        "target" = COALESCE(${patch.target}, "target"),
        "placements" = COALESCE(${patch.placements ?? null}, "placements"),
        "prompt_template" = COALESCE(${patch.promptTemplate}, "prompt_template"),
        "input_type" = COALESCE(${patch.inputType}, "input_type"),
        "output_mode" = COALESCE(${patch.outputMode}, "output_mode"),
        "llm_config_id" = COALESCE(${patch.llmConfigId ?? null}, "llm_config_id"),
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${actionId} AND "scope" = 'workspace' AND "workspace_id" = ${workspaceId}
      RETURNING *
    `,
  );

  const row = updated.rows?.[0];
  if (!row) {
    throw new Error("Failed to update action");
  }
  return mapActionRow(row);
}

async function softDeleteWorkspaceAction(workspaceId: string, actionId: string): Promise<void> {
  const existing = await getById(actionId);
  if (!existing) {
    throw new Error("Action not found");
  }
  if (existing.scope === "system") {
    throw new Error("Cannot delete system action via workspace API");
  }
  if (existing.workspaceId !== workspaceId) {
    throw new Error("Cannot delete action from another workspace");
  }

  await db.execute(
    sql`
      UPDATE "actions"
      SET "deleted_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${actionId} AND "scope" = 'workspace' AND "workspace_id" = ${workspaceId}
    `,
  );
}

export const actionsRepository = {
  getById,
  getByIdForWorkspace,
  listForWorkspace,
  createWorkspaceAction,
  updateWorkspaceAction,
  softDeleteWorkspaceAction,
};

export type { CreateActionPayload, UpdateActionPayload };

import { eq, and, or, isNull, desc } from "drizzle-orm";
import { db } from "./db";
import { actions, type Action } from "@shared/schema";
import { adjustWorkspaceObjectCounters } from "./usage/usage-service";
import { getUsagePeriodForDate } from "./usage/usage-types";
import { workspaceOperationGuard } from "./guards/workspace-operation-guard";
import { OperationBlockedError, mapDecisionToPayload } from "./guards/errors";
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

function mapActionToDto(row: Action): ActionDto {
  return {
    id: row.id,
    scope: row.scope as ActionScope,
    workspaceId: row.workspaceId,
    label: row.label,
    description: row.description,
    target: row.target as ActionTarget,
    placements: (row.placements ?? []) as ActionPlacement[],
    promptTemplate: row.promptTemplate,
    inputType: row.inputType as ActionInputType,
    outputMode: row.outputMode as ActionOutputMode,
    llmConfigId: row.llmConfigId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function getById(actionId: string): Promise<ActionDto | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.id, actionId), isNull(actions.deletedAt)))
    .limit(1);
  return row ? mapActionToDto(row) : null;
}

async function getByIdForWorkspace(workspaceId: string, actionId: string): Promise<ActionDto | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.id, actionId),
        isNull(actions.deletedAt),
        or(
          and(eq(actions.scope, "workspace"), eq(actions.workspaceId, workspaceId)),
          eq(actions.scope, "system")
        )
      )
    )
    .limit(1);
  return row ? mapActionToDto(row) : null;
}

async function listForWorkspace(
  workspaceId: string,
  options: { includeSystem?: boolean } = {},
): Promise<ActionDto[]> {
  const includeSystem = options.includeSystem ?? false;

  const condition = includeSystem
    ? and(
        isNull(actions.deletedAt),
        or(
          and(eq(actions.scope, "workspace"), eq(actions.workspaceId, workspaceId)),
          eq(actions.scope, "system")
        )
      )
    : and(
        isNull(actions.deletedAt),
        eq(actions.scope, "workspace"),
        eq(actions.workspaceId, workspaceId)
      );

  const rows = await db
    .select()
    .from(actions)
    .where(condition)
    .orderBy(desc(actions.createdAt));

  return rows.map(mapActionToDto);
}

async function createWorkspaceAction(
  workspaceId: string,
  payload: CreateActionPayload,
): Promise<ActionDto> {
  const decision = await workspaceOperationGuard.check({
    workspaceId,
    operationType: "CREATE_ACTION",
    expectedCost: { objects: 1 },
    meta: { objects: { entityType: "action" } },
  });
  if (!decision.allowed) {
    throw new OperationBlockedError(
      mapDecisionToPayload(decision, {
        workspaceId,
        operationType: "CREATE_ACTION",
        meta: { objects: { entityType: "action" } },
      }),
    );
  }

  const [row] = await db
    .insert(actions)
    .values({
      scope: "workspace",
      workspaceId,
      label: payload.label,
      description: payload.description ?? null,
      target: payload.target,
      placements: payload.placements,
      promptTemplate: payload.promptTemplate,
      inputType: payload.inputType,
      outputMode: payload.outputMode,
      llmConfigId: payload.llmConfigId ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create action");
  }

  const period = getUsagePeriodForDate(row.createdAt ? new Date(row.createdAt) : new Date());
  await adjustWorkspaceObjectCounters(workspaceId, { actionsDelta: 1 }, period);

  return mapActionToDto(row);
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

  const updateData: Partial<typeof actions.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.label !== undefined) updateData.label = patch.label;
  if (patch.description !== undefined) updateData.description = patch.description;
  if (patch.target !== undefined) updateData.target = patch.target;
  if (patch.placements !== undefined) updateData.placements = patch.placements;
  if (patch.promptTemplate !== undefined) updateData.promptTemplate = patch.promptTemplate;
  if (patch.inputType !== undefined) updateData.inputType = patch.inputType;
  if (patch.outputMode !== undefined) updateData.outputMode = patch.outputMode;
  if (patch.llmConfigId !== undefined) updateData.llmConfigId = patch.llmConfigId;

  const [row] = await db
    .update(actions)
    .set(updateData)
    .where(
      and(
        eq(actions.id, actionId),
        eq(actions.scope, "workspace"),
        eq(actions.workspaceId, workspaceId)
      )
    )
    .returning();

  if (!row) {
    throw new Error("Failed to update action");
  }
  return mapActionToDto(row);
}

async function softDeleteWorkspaceAction(workspaceId: string, actionId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.scope, "workspace")))
    .limit(1);

  if (!existing) {
    throw new Error("Action not found");
  }
  if (existing.scope === "system") {
    throw new Error("Cannot delete system action via workspace API");
  }
  if (existing.workspaceId !== workspaceId) {
    throw new Error("Cannot delete action from another workspace");
  }
  if (existing.deletedAt) {
    return;
  }

  const deletedAt = new Date();
  const [updated] = await db
    .update(actions)
    .set({
      deletedAt,
      updatedAt: deletedAt,
    })
    .where(
      and(
        eq(actions.id, actionId),
        eq(actions.scope, "workspace"),
        eq(actions.workspaceId, workspaceId),
        isNull(actions.deletedAt)
      )
    )
    .returning();

  if (!updated) {
    return;
  }

  const period = getUsagePeriodForDate(updated.deletedAt ? new Date(updated.deletedAt) : new Date());
  await adjustWorkspaceObjectCounters(workspaceId, { actionsDelta: -1 }, period);
}

async function listSystemActions(): Promise<ActionDto[]> {
  const rows = await db
    .select()
    .from(actions)
    .where(
      and(
        isNull(actions.deletedAt),
        eq(actions.scope, "system")
      )
    )
    .orderBy(desc(actions.createdAt));
  return rows.map(mapActionToDto);
}

export const actionsRepository = {
  getById,
  getByIdForWorkspace,
  listForWorkspace,
  listSystemActions,
  createWorkspaceAction,
  updateWorkspaceAction,
  softDeleteWorkspaceAction,
};

export type { ActionDto, CreateActionPayload, UpdateActionPayload };

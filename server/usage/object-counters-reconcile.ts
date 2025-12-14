import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { actions, knowledgeBases, skills, workspaceMembers } from "@shared/schema";
import {
  adjustWorkspaceObjectCounters,
  ensureWorkspaceUsage,
  getWorkspaceUsage,
  type WorkspaceObjectCountersDelta,
} from "./usage-service";
import type { UsagePeriod } from "./usage-types";

export type WorkspaceObjectCountersSnapshot = {
  skillsCount: number;
  actionsCount: number;
  knowledgeBasesCount: number;
  membersCount: number;
};

export async function calculateWorkspaceObjectCounters(workspaceId: string): Promise<WorkspaceObjectCountersSnapshot> {
  const [skillsRow, actionsRow, kbRow, membersRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(skills)
      .where(and(eq(skills.workspaceId, workspaceId), eq(skills.status, "active"), eq(skills.isSystem, false))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(actions)
      .where(and(eq(actions.scope, "workspace"), eq(actions.workspaceId, workspaceId), isNull(actions.deletedAt))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.workspaceId, workspaceId)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
  ]);

  return {
    skillsCount: Number(skillsRow[0]?.count ?? 0),
    actionsCount: Number(actionsRow[0]?.count ?? 0),
    knowledgeBasesCount: Number(kbRow[0]?.count ?? 0),
    membersCount: Number(membersRow[0]?.count ?? 0),
  };
}

export async function reconcileWorkspaceObjectCounters(
  workspaceId: string,
  period?: UsagePeriod,
): Promise<{
  workspaceId: string;
  previous: WorkspaceObjectCountersSnapshot;
  next: WorkspaceObjectCountersSnapshot;
  updated: boolean;
}> {
  const usage = await getWorkspaceUsage(workspaceId, period);
  const ensured = usage ?? (await ensureWorkspaceUsage(workspaceId, period));
  const actual = await calculateWorkspaceObjectCounters(workspaceId);

  const previous: WorkspaceObjectCountersSnapshot = {
    skillsCount: Number(ensured.skillsCount ?? 0),
    actionsCount: Number((ensured as any).actionsCount ?? 0),
    knowledgeBasesCount: Number(ensured.knowledgeBasesCount ?? 0),
    membersCount: Number(ensured.membersCount ?? 0),
  };

  const deltas: WorkspaceObjectCountersDelta = {
    skillsDelta: actual.skillsCount - previous.skillsCount,
    actionsDelta: actual.actionsCount - previous.actionsCount,
    knowledgeBasesDelta: actual.knowledgeBasesCount - previous.knowledgeBasesCount,
    membersDelta: actual.membersCount - previous.membersCount,
  };

  if (
    deltas.skillsDelta === 0 &&
    deltas.actionsDelta === 0 &&
    deltas.knowledgeBasesDelta === 0 &&
    deltas.membersDelta === 0
  ) {
    return { workspaceId, previous, next: previous, updated: false };
  }

  const updatedUsage = await adjustWorkspaceObjectCounters(workspaceId, deltas, period);

  const next: WorkspaceObjectCountersSnapshot = {
    skillsCount: Number(updatedUsage.skillsCount ?? 0),
    actionsCount: Number((updatedUsage as any).actionsCount ?? 0),
    knowledgeBasesCount: Number(updatedUsage.knowledgeBasesCount ?? 0),
    membersCount: Number(updatedUsage.membersCount ?? 0),
  };

  return { workspaceId, previous, next, updated: true };
}

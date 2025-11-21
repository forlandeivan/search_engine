import { describe, expect, it } from "vitest";
import {
  InMemorySkillExecutionLogRepository,
  SkillExecutionLogService,
} from "../server/skill-execution-log-service";
import { runSkillExecutionLogRetentionCleanup } from "../server/skill-execution-log-retention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("skill execution log retention cleanup", () => {
  const createService = () => {
    const repo = new InMemorySkillExecutionLogRepository();
    const service = new SkillExecutionLogService(repo);
    return { repo, service };
  };

  it("removes executions older than retention window and keeps recent ones", async () => {
    const { repo, service } = createService();
    const now = new Date();

    const oldExecution = await service.startExecution({
      workspaceId: "workspace-1",
      skillId: "skill-old",
      source: "system_unica_chat",
    });
    repo.executions[0]!.startedAt = new Date(now.getTime() - 10 * DAY_MS);
    await service.finishExecution(oldExecution!.id, "success");

    const freshExecution = await service.startExecution({
      workspaceId: "workspace-1",
      skillId: "skill-new",
      source: "system_unica_chat",
    });
    repo.executions[1]!.startedAt = new Date(now.getTime() - 2 * DAY_MS);
    await service.finishExecution(freshExecution!.id, "success");

    const result = await runSkillExecutionLogRetentionCleanup({
      now,
      retentionDays: 5,
      batchSize: 100,
      service,
    });

    expect(result.deleted).toBe(1);
    expect(repo.executions).toHaveLength(1);
    expect(repo.executions[0]!.id).toBe(freshExecution!.id);
  });

  it("cleans up in batches", async () => {
    const { repo, service } = createService();
    const now = new Date();

    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const execution = await service.startExecution({
        workspaceId: "workspace-1",
        skillId: `skill-${index}`,
        source: "workspace_skill",
      });
      repo.executions[index]!.startedAt = new Date(now.getTime() - 20 * DAY_MS);
      await service.finishExecution(execution!.id, "success");
      ids.push(execution!.id);
    }

    const result = await runSkillExecutionLogRetentionCleanup({
      now,
      retentionDays: 7,
      batchSize: 2,
      service,
    });

    expect(result.deleted).toBe(5);
    expect(repo.executions).toHaveLength(0);
    expect(repo.steps).toHaveLength(0);
  });
});

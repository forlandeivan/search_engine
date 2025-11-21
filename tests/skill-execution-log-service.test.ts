import { describe, expect, it } from "vitest";
import {
  InMemorySkillExecutionLogRepository,
  SkillExecutionLogService,
  sanitizePayload,
} from "../server/skill-execution-log-service";

describe("SkillExecutionLogService", () => {
  const createService = () => {
    const repo = new InMemorySkillExecutionLogRepository();
    return { repo, service: new SkillExecutionLogService(repo) };
  };

  it("создаёт запуск и шаги (happy path)", async () => {
    const { repo, service } = createService();
    const execution = await service.startExecution({
      workspaceId: "workspace-1",
      skillId: "skill-1",
      source: "system_unica_chat",
      userId: "user-1",
      chatId: "chat-1",
    });
    expect(execution).not.toBeNull();

    await service.logStep({
      executionId: execution!.id,
      type: "RECEIVE_HTTP_REQUEST",
      status: "success",
      input: { text: "hello" },
      output: { accepted: true },
    });

    await service.finishExecution(execution!.id, "success");

    expect(repo.executions).toHaveLength(1);
    expect(repo.steps).toHaveLength(1);
    expect(repo.executions[0].status).toBe("success");
    expect(repo.executions[0].hasStepErrors).toBe(false);
  });

  it("помечает запуск с ошибкой при ошибочном шаге", async () => {
    const { repo, service } = createService();
    const execution = await service.startExecution({
      workspaceId: "workspace-1",
      skillId: "skill-1",
      source: "system_unica_chat",
    });
    expect(execution).not.toBeNull();

    await service.logStep({
      executionId: execution!.id,
      type: "CALL_LLM",
      status: "error",
      errorCode: "LLM_401",
      errorMessage: "Unauthorized",
    });

    await service.finishExecution(execution!.id, "error");
    expect(repo.executions[0].hasStepErrors).toBe(true);
    expect(repo.steps[0].status).toBe("error");
  });

  it("санитизирует чувствительные поля", () => {
    const sanitized = sanitizePayload({
      token: "secret",
      password: "12345",
      nested: { apiKey: "value", safe: "text" },
    });
    expect(sanitized).toEqual({
      token: "***MASKED***",
      password: "***MASKED***",
      nested: { apiKey: "***MASKED***", safe: "text" },
    });
  });

  it("ограничивает размеры строк, массивов и объектов", () => {
    const longString = "x".repeat(600);
    const sanitized = sanitizePayload(
      {
        longString,
        arr: Array.from({ length: 60 }, (_, index) => index),
        obj: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`key${index}`, index])),
      },
      { maxDepth: 3, maxStringLength: 100, maxArrayLength: 5, maxObjectKeys: 5 },
    );

    expect((sanitized as any).longString.length).toBeLessThanOrEqual(101);
    expect((sanitized as any).arr.length).toBe(6);
    expect((sanitized as any).arr[5]).toBe("***TRUNCATED_ARRAY***");
    expect((sanitized as any).obj.__truncatedKeys).toBe("***TRUNCATED_OBJECT***");
  });
  it("tracks error flag via helper methods", async () => {
    const { repo, service } = createService();
    const execution = await service.startExecution({
      workspaceId: "workspace-1",
      skillId: "skill-1",
      source: "system_unica_chat",
    });
    if (!execution) {
      throw new Error('execution not created');
    }

    await service.logStepSuccess({ executionId: execution.id, type: "RECEIVE_HTTP_REQUEST" });
    await service.logStepError({ executionId: execution.id, type: "CALL_LLM", errorMessage: "llm" });
    await service.markExecutionSuccess(execution.id);
    expect(repo.executions[0]?.hasStepErrors).toBe(true);
    expect(repo.executions[0]?.status).toBe("success");

    await service.markExecutionFailed(execution.id);
    expect(repo.executions[0]?.status).toBe("error");
  });

});

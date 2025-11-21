import { describe, expect, it } from "vitest";
import {
  UNICA_CHAT_PIPELINE,
  canStepEmitStreamData,
  isTerminalExecutionStatus,
  type SkillExecutionStepType,
} from "../server/skill-execution-log";

describe("skill-execution-log design", () => {
  it("exposes уникальный список шагов пайплайна Unica Chat", () => {
    const set = new Set<SkillExecutionStepType>();
    for (const step of UNICA_CHAT_PIPELINE) {
      expect(set.has(step)).toBe(false);
      set.add(step);
    }
    expect(UNICA_CHAT_PIPELINE[0]).toBe("RECEIVE_HTTP_REQUEST");
    expect(UNICA_CHAT_PIPELINE[UNICA_CHAT_PIPELINE.length - 1]).toBe("FINALIZE_EXECUTION");
  });

  it("определяет терминальные статусы", () => {
    expect(isTerminalExecutionStatus("success")).toBe(true);
    expect(isTerminalExecutionStatus("error")).toBe(true);
    expect(isTerminalExecutionStatus("timeout")).toBe(true);
    expect(isTerminalExecutionStatus("cancelled")).toBe(true);
    expect(isTerminalExecutionStatus("pending")).toBe(false);
    expect(isTerminalExecutionStatus("running")).toBe(false);
  });

  it("распознаёт шаги со стримом", () => {
    expect(canStepEmitStreamData("STREAM_TO_CLIENT_START")).toBe(true);
    expect(canStepEmitStreamData("STREAM_TO_CLIENT_FINISH")).toBe(true);
    expect(canStepEmitStreamData("CALL_LLM")).toBe(false);
  });
});

/* @vitest-environment jsdom */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExecutionStepsTimeline } from "@/components/llm-executions/ExecutionStepsTimeline";
import type { LlmExecutionStep } from "@/types/llm-execution";

const baseStep = {
  id: "step-1",
  type: "CALL_LLM",
  status: "success",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  input: { foo: "bar" },
  output: { httpStatus: 200 },
  errorCode: null,
  errorMessage: null,
  diagnosticInfo: null,
} satisfies LlmExecutionStep;

describe("ExecutionStepsTimeline", () => {
  it("shows placeholder when there are no steps", () => {
    render(<ExecutionStepsTimeline steps={[]} />);
    expect(screen.getByText(/нет подробных шагов/i)).toBeTruthy();
  });

  it("renders step titles and toggles details", () => {
    render(<ExecutionStepsTimeline steps={[baseStep]} />);
    expect(screen.getByText(/Вызов LLM/i)).toBeTruthy();

    const toggle = screen.getByText(/Развернуть детали/i);
    fireEvent.click(toggle);
    expect(screen.getByText(/Входные данные/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Свернуть детали/i));
  });

  it("expands and collapses all steps with buttons", () => {
    const steps: LlmExecutionStep[] = [
      baseStep,
      { ...baseStep, id: "step-2", type: "WRITE_USER_MESSAGE" },
    ];
    render(<ExecutionStepsTimeline steps={steps} />);

    fireEvent.click(screen.getByText(/Развернуть все/i));
    expect(screen.getAllByText(/Входные данные/i)).toHaveLength(2);

    fireEvent.click(screen.getByText(/Свернуть все/i));
    expect(screen.queryAllByText(/Входные данные/i)).toHaveLength(0);
  });
});

let debugPromptsEnabled = process.env.LLM_LOG_DEBUG_PROMPTS === "true";

export function isLlmPromptDebugEnabled(): boolean {
  return debugPromptsEnabled;
}

export function setLlmPromptDebugEnabled(enabled: boolean): void {
  debugPromptsEnabled = enabled;
}

export function getLlmPromptDebugConfig() {
  return { enabled: debugPromptsEnabled };
}

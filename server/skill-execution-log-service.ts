import { randomUUID } from "crypto";
import type { Json } from "drizzle-orm/json";
import {
  SkillExecutionRecord,
  SkillExecutionSource,
  SkillExecutionStatus,
  SkillExecutionStepRecord,
  SkillExecutionStepStatus,
  SkillExecutionStepType,
  SKILL_EXECUTION_STATUS,
  SKILL_EXECUTION_STEP_STATUS,
} from "./skill-execution-log";

export interface SkillExecutionLogRepository {
  createExecution(record: SkillExecutionRecord): Promise<void>;
  updateExecution(id: string, updates: Partial<SkillExecutionRecord>): Promise<void>;
  createStep(record: SkillExecutionStepRecord): Promise<void>;
  listExecutions(): Promise<SkillExecutionRecord[]>;
  getExecutionById(id: string): Promise<SkillExecutionRecord | null>;
  listExecutionSteps(executionId: string): Promise<SkillExecutionStepRecord[]>;
  deleteExecutions(executionIds: readonly string[]): Promise<void>;
}

export type SkillExecutionStartContext = {
  workspaceId: string;
  skillId: string;
  source: SkillExecutionSource;
  userId?: string | null;
  chatId?: string | null;
  userMessageId?: string | null;
  metadata?: Json;
};

export interface SkillExecutionLogServiceOptions {
  enabled?: boolean;
  sanitizeOptions?: Partial<SanitizeOptions>;
}

export interface LogStepParams {
  executionId: string;
  type: SkillExecutionStepType;
  status: SkillExecutionStepStatus;
  input?: unknown;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  diagnosticInfo?: string;
}

const DEFAULT_SANITIZE_OPTIONS: SanitizeOptions = {
  maxDepth: 5,
  maxStringLength: 500,
  maxArrayLength: 50,
  maxObjectKeys: 50,
};

interface SanitizeOptions {
  maxDepth: number;
  maxStringLength: number;
  maxArrayLength: number;
  maxObjectKeys: number;
}

const SENSITIVE_KEY_PATTERN = /(token|secret|apikey|authorization|password)/i;

export class SkillExecutionLogService {
  private readonly repository: SkillExecutionLogRepository;
  private readonly enabled: boolean;
  private readonly sanitizeOptions: SanitizeOptions;
  private readonly stepCounters = new Map<string, number>();
  private readonly executionHasErrors = new Set<string>();

  constructor(repository: SkillExecutionLogRepository, options: SkillExecutionLogServiceOptions = {}) {
    this.repository = repository;
    this.enabled = options.enabled ?? true;
    this.sanitizeOptions = { ...DEFAULT_SANITIZE_OPTIONS, ...options.sanitizeOptions };
  }

  async startExecution(context: SkillExecutionStartContext): Promise<SkillExecutionRecord | null> {
    if (!this.enabled) {
      return null;
    }

    const execution: SkillExecutionRecord = {
      id: randomUUID(),
      workspaceId: context.workspaceId,
      userId: context.userId ?? null,
      skillId: context.skillId,
      chatId: context.chatId ?? null,
      userMessageId: context.userMessageId ?? null,
      source: context.source,
      status: SKILL_EXECUTION_STATUS.RUNNING,
      hasStepErrors: false,
      startedAt: new Date(),
      finishedAt: null,
      metadata: context.metadata ? sanitizePayload(context.metadata, this.sanitizeOptions) : undefined,
    };

    await this.repository.createExecution(execution);
    this.stepCounters.set(execution.id, 0);
    return execution;
  }

  async logStep(params: LogStepParams): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const order = (this.stepCounters.get(params.executionId) ?? 0) + 1;
    this.stepCounters.set(params.executionId, order);

    const step: SkillExecutionStepRecord = {
      id: randomUUID(),
      executionId: params.executionId,
      order,
      type: params.type,
      status: params.status,
      startedAt: new Date(),
      finishedAt: new Date(),
      inputPayload: sanitizePayload(params.input ?? null, this.sanitizeOptions),
      outputPayload: sanitizePayload(params.output ?? null, this.sanitizeOptions),
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      diagnosticInfo: params.diagnosticInfo,
    };

    if (params.status === SKILL_EXECUTION_STEP_STATUS.ERROR) {
      this.executionHasErrors.add(params.executionId);
    }

    await this.repository.createStep(step);
  }

  async logStepSuccess(params: Omit<LogStepParams, "status">): Promise<void> {
    await this.logStep({ ...params, status: SKILL_EXECUTION_STEP_STATUS.SUCCESS });
  }

  async logStepError(params: Omit<LogStepParams, "status">): Promise<void> {
    await this.logStep({ ...params, status: SKILL_EXECUTION_STEP_STATUS.ERROR });
  }

  async finishExecution(
    executionId: string,
    finalStatus: SkillExecutionStatus,
    extra?: Partial<Pick<SkillExecutionRecord, "userMessageId">>,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const updates: Partial<SkillExecutionRecord> = {
      status: finalStatus,
      finishedAt: new Date(),
      hasStepErrors: this.executionHasErrors.has(executionId),
      userMessageId: extra?.userMessageId ?? undefined,
    };

    await this.repository.updateExecution(executionId, updates);
    this.stepCounters.delete(executionId);
    this.executionHasErrors.delete(executionId);
  }

  async markExecutionSuccess(
    executionId: string,
    extra?: Partial<Pick<SkillExecutionRecord, "userMessageId">>,
  ): Promise<void> {
    await this.finishExecution(executionId, SKILL_EXECUTION_STATUS.SUCCESS, extra);
  }

  async markExecutionFailed(
    executionId: string,
    extra?: Partial<Pick<SkillExecutionRecord, "userMessageId">>,
  ): Promise<void> {
    await this.finishExecution(executionId, SKILL_EXECUTION_STATUS.ERROR, extra);
  }

  async listExecutions(): Promise<SkillExecutionRecord[]> {
    return this.repository.listExecutions();
  }

  async getExecutionById(id: string): Promise<SkillExecutionRecord | null> {
    return this.repository.getExecutionById(id);
  }

  async listExecutionSteps(executionId: string): Promise<SkillExecutionStepRecord[]> {
    return this.repository.listExecutionSteps(executionId);
  }

  async deleteExecutions(executionIds: readonly string[]): Promise<number> {
    if (!this.enabled || executionIds.length === 0) {
      return 0;
    }
    executionIds.forEach((id) => {
      this.stepCounters.delete(id);
      this.executionHasErrors.delete(id);
    });
    await this.repository.deleteExecutions(executionIds);
    return executionIds.length;
  }
}

export function sanitizePayload(value: unknown, options: SanitizeOptions = DEFAULT_SANITIZE_OPTIONS): Json {
  return sanitizeInternal(value, options, 0);
}

function sanitizeInternal(value: unknown, options: SanitizeOptions, depth: number): Json {
  if (depth > options.maxDepth) {
    return "***TRUNCATED***";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > options.maxStringLength ? `${value.slice(0, options.maxStringLength)}…` : value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const result: Json[] = [];
    for (let i = 0; i < Math.min(value.length, options.maxArrayLength); i += 1) {
      result.push(sanitizeInternal(value[i], options, depth + 1));
    }
    if (value.length > options.maxArrayLength) {
      result.push("***TRUNCATED_ARRAY***");
    }
    return result;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, Json> = {};
    for (let i = 0; i < Math.min(entries.length, options.maxObjectKeys); i += 1) {
      const [key, entryValue] = entries[i];
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "***MASKED***";
        continue;
      }
      result[key] = sanitizeInternal(entryValue, options, depth + 1);
    }
    if (entries.length > options.maxObjectKeys) {
      result["__truncatedKeys"] = "***TRUNCATED_OBJECT***";
    }
    return result;
  }

  return String(value).slice(0, options.maxStringLength);
}

export class InMemorySkillExecutionLogRepository implements SkillExecutionLogRepository {
  public executions: SkillExecutionRecord[] = [];
  public steps: SkillExecutionStepRecord[] = [];

  async createExecution(record: SkillExecutionRecord): Promise<void> {
    this.executions.push(cloneRecord(record));
  }

  async updateExecution(id: string, updates: Partial<SkillExecutionRecord>): Promise<void> {
    const target = this.executions.find((execution) => execution.id === id);
    if (!target) {
      throw new Error(`Execution ${id} not found`);
    }
    Object.assign(target, updates);
  }

  async createStep(record: SkillExecutionStepRecord): Promise<void> {
    this.steps.push(cloneRecord(record));
  }

  async listExecutions(): Promise<SkillExecutionRecord[]> {
    return this.executions.map(cloneRecord);
  }

  async getExecutionById(id: string): Promise<SkillExecutionRecord | null> {
    const target = this.executions.find((execution) => execution.id === id);
    return target ? cloneRecord(target) : null;
  }

  async listExecutionSteps(executionId: string): Promise<SkillExecutionStepRecord[]> {
    return this.steps
      .filter((step) => step.executionId === executionId)
      .sort((a, b) => a.order - b.order)
      .map(cloneRecord);
  }

  async deleteExecutions(executionIds: readonly string[]): Promise<void> {
    if (executionIds.length === 0) {
      return;
    }
    const idSet = new Set(executionIds);
    this.executions = this.executions.filter((execution) => !idSet.has(execution.id));
    this.steps = this.steps.filter((step) => !idSet.has(step.executionId));
  }
}

function cloneRecord<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

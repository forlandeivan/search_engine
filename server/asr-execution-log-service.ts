import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import type {
  AsrExecutionRecord,
  AsrExecutionStatus,
  AsrExecutionCreateInput,
  AsrExecutionUpdateInput,
  AsrExecutionEvent,
  AsrExecutionStage,
} from "./asr-execution-log";

// Investigation note for executionId=8b12aba2-82a0-4a4b-baf0-fdbbfc3584cb:
// - В текущей БД таблицы asr_executions нет (миграция 0048 не применена), поэтому записи по этому id нет.
// - При этом transcript 902729e8-1720-4c4f-a5ad-f07f96e3afa4 и placeholder message уже в status=ready с текстом,
//   значит транскрибация прошла до конца, но лог ASR не сохранялся из-за отсутствующей таблицы.

export interface AsrExecutionLogRepository {
  createExecution(record: AsrExecutionRecord): Promise<void>;
  updateExecution(id: string, updates: Partial<AsrExecutionRecord>): Promise<void>;
  getExecutionById(id: string): Promise<AsrExecutionRecord | null>;
  listExecutions(): Promise<AsrExecutionRecord[]>;
}

export class DatabaseAsrExecutionRepository implements AsrExecutionLogRepository {
  private mapRow(row: any): AsrExecutionRecord {
    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      workspaceId: row.workspace_id,
      skillId: row.skill_id,
      chatId: row.chat_id,
      userMessageId: row.user_message_id,
      transcriptMessageId: row.transcript_message_id,
      transcriptId: row.transcript_id,
      provider: row.provider,
      mode: row.mode,
      status: row.status,
      language: row.language,
      fileName: row.file_name,
      fileSizeBytes: row.file_size_bytes !== null ? Number(row.file_size_bytes) : null,
      durationMs: row.duration_ms !== null ? Number(row.duration_ms) : null,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      pipelineEvents: Array.isArray(row.pipeline_events) ? row.pipeline_events : row.pipeline_events ? row.pipeline_events : [],
    };
  }

  async createExecution(record: AsrExecutionRecord): Promise<void> {
    await db.execute(sql`
      INSERT INTO asr_executions (
        id, created_at, updated_at, workspace_id, skill_id, chat_id,
        user_message_id, transcript_message_id, transcript_id,
        provider, mode, status, language, file_name, file_size_bytes,
        duration_ms, started_at, finished_at, error_code, error_message, pipeline_events
      )
      VALUES (
        ${record.id},
        ${record.createdAt.toISOString()},
        ${record.updatedAt.toISOString()},
        ${record.workspaceId},
        ${record.skillId},
        ${record.chatId},
        ${record.userMessageId},
        ${record.transcriptMessageId},
        ${record.transcriptId},
        ${record.provider},
        ${record.mode},
        ${record.status},
        ${record.language},
        ${record.fileName},
        ${record.fileSizeBytes},
        ${record.durationMs},
        ${record.startedAt ? record.startedAt.toISOString() : null},
        ${record.finishedAt ? record.finishedAt.toISOString() : null},
        ${record.errorCode},
        ${record.errorMessage},
        ${JSON.stringify(record.pipelineEvents ?? [])}::jsonb
      )
    `);
  }

  async updateExecution(id: string, updates: Partial<AsrExecutionRecord>): Promise<void> {
    const sets: any[] = [];
    const addSet = (fragment: any) => sets.push(fragment);

    addSet(sql`updated_at = ${updates.updatedAt ? updates.updatedAt.toISOString() : new Date().toISOString()}`);
    if (updates.workspaceId !== undefined) addSet(sql`workspace_id = ${updates.workspaceId}`);
    if (updates.skillId !== undefined) addSet(sql`skill_id = ${updates.skillId}`);
    if (updates.chatId !== undefined) addSet(sql`chat_id = ${updates.chatId}`);
    if (updates.userMessageId !== undefined) addSet(sql`user_message_id = ${updates.userMessageId}`);
    if (updates.transcriptMessageId !== undefined) addSet(sql`transcript_message_id = ${updates.transcriptMessageId}`);
    if (updates.transcriptId !== undefined) addSet(sql`transcript_id = ${updates.transcriptId}`);
    if (updates.provider !== undefined) addSet(sql`provider = ${updates.provider}`);
    if (updates.mode !== undefined) addSet(sql`mode = ${updates.mode}`);
    if (updates.status !== undefined) addSet(sql`status = ${updates.status}`);
    if (updates.language !== undefined) addSet(sql`language = ${updates.language}`);
    if (updates.fileName !== undefined) addSet(sql`file_name = ${updates.fileName}`);
    if (updates.fileSizeBytes !== undefined) addSet(sql`file_size_bytes = ${updates.fileSizeBytes}`);
    if (updates.durationMs !== undefined) addSet(sql`duration_ms = ${updates.durationMs}`);
    if (updates.startedAt !== undefined) addSet(sql`started_at = ${updates.startedAt ? updates.startedAt.toISOString() : null}`);
    if (updates.finishedAt !== undefined) addSet(sql`finished_at = ${updates.finishedAt ? updates.finishedAt.toISOString() : null}`);
    if (updates.errorCode !== undefined) addSet(sql`error_code = ${updates.errorCode}`);
    if (updates.errorMessage !== undefined) addSet(sql`error_message = ${updates.errorMessage}`);
    if (updates.pipelineEvents !== undefined) addSet(sql`pipeline_events = ${JSON.stringify(updates.pipelineEvents ?? [])}::jsonb`);

    if (sets.length === 0) return;
    const setClause = sets.reduce((acc, part, idx) => (idx === 0 ? part : sql`${acc}, ${part}`));
    await db.execute(sql`UPDATE asr_executions SET ${setClause} WHERE id = ${id}`);
  }

  async getExecutionById(id: string): Promise<AsrExecutionRecord | null> {
    const result = await db.execute(sql`SELECT * FROM asr_executions WHERE id = ${id} LIMIT 1`);
    const row = (result as any)?.rows?.[0];
    return row ? this.mapRow(row) : null;
  }

  async listExecutions(): Promise<AsrExecutionRecord[]> {
    const result = await db.execute(sql`SELECT * FROM asr_executions ORDER BY created_at DESC`);
    return ((result as any)?.rows ?? []).map((row: any) => this.mapRow(row));
  }
}

export class InMemoryAsrExecutionRepository implements AsrExecutionLogRepository {
  private executions: AsrExecutionRecord[] = [];

  async createExecution(record: AsrExecutionRecord): Promise<void> {
    this.executions.push(record);
  }

  async updateExecution(id: string, updates: Partial<AsrExecutionRecord>): Promise<void> {
    this.executions = this.executions.map((item) =>
      item.id === id ? { ...item, ...updates, updatedAt: updates.updatedAt ?? new Date() } : item,
    );
  }

  async getExecutionById(id: string): Promise<AsrExecutionRecord | null> {
    return this.executions.find((item) => item.id === id) ?? null;
  }

  async listExecutions(): Promise<AsrExecutionRecord[]> {
    return [...this.executions];
  }
}

export class AsrExecutionLogService {
  private readonly repository: AsrExecutionLogRepository;

  constructor(repository: AsrExecutionLogRepository) {
    this.repository = repository;
  }

  async createExecution(input: AsrExecutionCreateInput = {}): Promise<AsrExecutionRecord> {
    const now = new Date();
    const record: AsrExecutionRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      workspaceId: input.workspaceId ?? null,
      skillId: input.skillId ?? null,
      chatId: input.chatId ?? null,
      userMessageId: input.userMessageId ?? null,
      transcriptMessageId: input.transcriptMessageId ?? null,
      transcriptId: input.transcriptId ?? null,
      provider: input.provider ?? null,
      mode: input.mode ?? null,
      status: input.status ?? "pending",
      language: input.language ?? null,
      fileName: input.fileName ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      durationMs: input.durationMs ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      pipelineEvents: Array.isArray(input.pipelineEvents)
        ? (input.pipelineEvents as AsrExecutionRecord["pipelineEvents"])
        : [],
    };
    await this.repository.createExecution(record);
    return record;
  }

  async updateExecution(id: string, updates: AsrExecutionUpdateInput): Promise<void> {
    const patch: Partial<AsrExecutionRecord> = { ...updates, updatedAt: updates.updatedAt ?? new Date() };
    await this.repository.updateExecution(id, patch);
  }

  async getExecutionById(id: string): Promise<AsrExecutionRecord | null> {
    return this.repository.getExecutionById(id);
  }

  async listExecutions(): Promise<AsrExecutionRecord[]> {
    return this.repository.listExecutions();
  }

  async addEvent(
    executionId: string,
    event: { stage: AsrExecutionStage | string; details?: unknown },
    status?: AsrExecutionStatus,
    error?: { code?: string | null; message?: string | null },
  ): Promise<void> {
    const execution = await this.repository.getExecutionById(executionId);
    if (!execution) return;
    const evt: AsrExecutionEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      stage: event.stage,
      details: event.details as any,
    };
    const pipelineEvents = [...(execution.pipelineEvents ?? []), evt];
    const updates: Partial<AsrExecutionRecord> = {
      pipelineEvents,
      updatedAt: new Date(),
    };
    if (status) {
      updates.status = status;
    }
    if (error) {
      updates.errorCode = error.code ?? null;
      updates.errorMessage = error.message ?? null;
    }
    await this.repository.updateExecution(executionId, updates);
  }
}

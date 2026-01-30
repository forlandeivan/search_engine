import { log } from "./vite";
import type { UnicaAsrConfig } from "../shared/schema";

// Запрос на транскрибацию
export interface UnicaRecognitionRequest {
  FilePath: string;
  WorkspaceId: string;
  ProcessingOptions: {
    Language: string; // "ru"
  };
}

// Ответ с задачей транскрибации
export interface UnicaRecognitionTask {
  id: string;
  workspaceId: string;
  status: "Queued" | "Processing" | "Completed" | "Failed";
  createdAt: string;
  updatedAt: string;
  resultDatasetId: string | null;
  error: string | null;
}

// Ответ датасета
export interface UnicaDatasetResponse {
  dataset: {
    text: string;
    // ... другие поля
  };
}

// Результат транскрибации
export interface UnicaTranscriptionResult {
  taskId: string;
  status: "success" | "failed";
  text?: string;
  error?: string;
  durationMs: number;
}

// Ошибка Unica ASR
export class UnicaAsrError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "UnicaAsrError";
  }
}

// Retry механизм для fetch
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error as Error;
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }

  throw lastError;
}

export class UnicaAsrService {
  private operationsCache: Map<
    string,
    {
      taskId: string;
      config: UnicaAsrConfig;
      startedAt: Date;
      filePath: string;
    }
  > = new Map();

  /**
   * Запустить асинхронную транскрибацию
   */
  async startRecognition(
    filePath: string,
    config: UnicaAsrConfig
  ): Promise<{ taskId: string; operationId: string }> {
    const url = `${config.baseUrl}/asr/SpeechRecognition/recognize/async`;

    const body: UnicaRecognitionRequest = {
      FilePath: filePath,
      WorkspaceId: config.workspaceId,
      ProcessingOptions: {
        Language: "ru",
      },
    };

    log(`[UnicaASR] Starting recognition: ${filePath}`);

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new UnicaAsrError(
        `Failed to start recognition: ${errorText}`,
        "START_RECOGNITION_FAILED",
        response.status
      );
    }

    const task: UnicaRecognitionTask = await response.json();

    // Генерируем operationId для совместимости с существующей архитектурой
    const operationId = `unica_${task.id}`;

    // Сохраняем в кэш
    this.operationsCache.set(operationId, {
      taskId: task.id,
      config,
      startedAt: new Date(),
      filePath,
    });

    log(`[UnicaASR] Task created: ${task.id}, operationId: ${operationId}`);

    return { taskId: task.id, operationId };
  }

  /**
   * Получить статус задачи транскрибации
   */
  async getTaskStatus(taskId: string, config: UnicaAsrConfig): Promise<UnicaRecognitionTask> {
    const url = `${config.baseUrl}/asr/SpeechRecognition/recognition-task/${taskId}?workSpaceId=${config.workspaceId}`;

    const response = await fetchWithRetry(url, { method: "GET" });

    if (!response.ok) {
      const errorText = await response.text();
      throw new UnicaAsrError(
        `Failed to get task status: ${errorText}`,
        "GET_STATUS_FAILED",
        response.status
      );
    }

    return response.json();
  }

  /**
   * Получить текст из датасета
   */
  async getDatasetText(datasetId: string, config: UnicaAsrConfig, version: number = 1): Promise<string> {
    const url = `${config.baseUrl}/datamanagement/Datasets/${datasetId}?workspaceId=${config.workspaceId}&version=${version}`;

    const response = await fetchWithRetry(url, { method: "GET" });

    if (!response.ok) {
      const errorText = await response.text();
      throw new UnicaAsrError(
        `Failed to get dataset: ${errorText}`,
        "GET_DATASET_FAILED",
        response.status
      );
    }

    const data: UnicaDatasetResponse = await response.json();
    return data.dataset.text;
  }

  /**
   * Получить статус операции по operationId
   * (для совместимости с существующим polling механизмом)
   */
  async getOperationStatus(operationId: string): Promise<{
    done: boolean;
    status: "pending" | "processing" | "completed" | "failed";
    text?: string;
    error?: string;
  }> {
    const cached = this.operationsCache.get(operationId);
    if (!cached) {
      throw new UnicaAsrError(`Operation not found: ${operationId}`, "OPERATION_NOT_FOUND");
    }

    const { taskId, config, startedAt } = cached;
    const timeoutMs = config.timeoutMs || 3600000; // 60 минут по умолчанию

    // Проверка таймаута
    if (Date.now() - startedAt.getTime() > timeoutMs) {
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "failed",
        error: "Transcription timeout",
      };
    }

    const task = await this.getTaskStatus(taskId, config);

    if (task.status === "Failed") {
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "failed",
        error: task.error || "Unknown error",
      };
    }

    if (task.status === "Completed" && task.resultDatasetId) {
      const text = await this.getDatasetText(task.resultDatasetId, config);
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "completed",
        text,
      };
    }

    // Queued или Processing
    return {
      done: false,
      status: task.status === "Queued" ? "pending" : "processing",
    };
  }

  /**
   * Очистить операцию из кэша
   */
  clearOperation(operationId: string): void {
    this.operationsCache.delete(operationId);
  }

  /**
   * Получить информацию о кэшированных операциях (для отладки)
   */
  getCachedOperations(): Array<{
    operationId: string;
    taskId: string;
    startedAt: Date;
    filePath: string;
  }> {
    const operations: Array<{
      operationId: string;
      taskId: string;
      startedAt: Date;
      filePath: string;
    }> = [];

    for (const [operationId, data] of this.operationsCache.entries()) {
      operations.push({
        operationId,
        taskId: data.taskId,
        startedAt: data.startedAt,
        filePath: data.filePath,
      });
    }

    return operations;
  }
}

// Singleton экземпляр
export const unicaAsrService = new UnicaAsrService();

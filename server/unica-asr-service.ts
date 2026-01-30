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

    log("[UnicaASR] ========== START RECOGNITION ==========");
    log("[UnicaASR] File path:", filePath);
    log("[UnicaASR] Config:", {
      baseUrl: config.baseUrl,
      workspaceId: config.workspaceId,
      pollingIntervalMs: config.pollingIntervalMs,
      timeoutMs: config.timeoutMs,
    });
    log("[UnicaASR] POST", url);
    log("[UnicaASR] Request body:", JSON.stringify(body, null, 2));

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    log("[UnicaASR] Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      log("[UnicaASR] ❌ Error response:", errorText);
      throw new UnicaAsrError(
        `Failed to start recognition: ${errorText}`,
        "START_RECOGNITION_FAILED",
        response.status
      );
    }

    const task: UnicaRecognitionTask = await response.json();
    log("[UnicaASR] ✅ Response body:", JSON.stringify(task, null, 2));

    // Генерируем operationId для совместимости с существующей архитектурой
    const operationId = `unica_${task.id}`;

    // Сохраняем в кэш
    this.operationsCache.set(operationId, {
      taskId: task.id,
      config,
      startedAt: new Date(),
      filePath,
    });

    log("[UnicaASR] Task created. Task ID:", task.id);
    log("[UnicaASR] Operation ID:", operationId);
    log("[UnicaASR] ========================================");

    return { taskId: task.id, operationId };
  }

  /**
   * Получить статус задачи транскрибации
   */
  async getTaskStatus(taskId: string, config: UnicaAsrConfig): Promise<UnicaRecognitionTask> {
    const url = `${config.baseUrl}/asr/SpeechRecognition/recognition-task/${taskId}?workSpaceId=${config.workspaceId}`;

    log("[UnicaASR] ========== GET TASK STATUS ==========");
    log("[UnicaASR] Task ID:", taskId);
    log("[UnicaASR] GET", url);

    const response = await fetchWithRetry(url, { method: "GET" });

    log("[UnicaASR] Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      log("[UnicaASR] ❌ Error response:", errorText);
      throw new UnicaAsrError(
        `Failed to get task status: ${errorText}`,
        "GET_STATUS_FAILED",
        response.status
      );
    }

    const task = await response.json();
    log("[UnicaASR] ✅ Task status:", task.status);
    log("[UnicaASR] Response body:", JSON.stringify(task, null, 2));
    log("[UnicaASR] ========================================");

    return task;
  }

  /**
   * Получить текст из датасета
   */
  async getDatasetText(datasetId: string, config: UnicaAsrConfig, version: number = 1): Promise<string> {
    const url = `${config.baseUrl}/datamanagement/Datasets/${datasetId}?workspaceId=${config.workspaceId}&version=${version}`;

    log("[UnicaASR] ========== GET DATASET TEXT ==========");
    log("[UnicaASR] Dataset ID:", datasetId);
    log("[UnicaASR] Version:", version);
    log("[UnicaASR] GET", url);

    const response = await fetchWithRetry(url, { method: "GET" });

    log("[UnicaASR] Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      log("[UnicaASR] ❌ Error response:", errorText);
      throw new UnicaAsrError(
        `Failed to get dataset: ${errorText}`,
        "GET_DATASET_FAILED",
        response.status
      );
    }

    const data: UnicaDatasetResponse = await response.json();
    const text = data.dataset.text;
    
    log("[UnicaASR] ✅ Dataset retrieved");
    log("[UnicaASR] Text length:", text.length, "chars");
    log("[UnicaASR] Text preview (first 200 chars):", text.substring(0, 200));
    log("[UnicaASR] ========================================");

    return text;
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
    log("[UnicaASR] ========== GET OPERATION STATUS ==========");
    log("[UnicaASR] Operation ID:", operationId);

    const cached = this.operationsCache.get(operationId);
    if (!cached) {
      log("[UnicaASR] ❌ Operation not found in cache");
      throw new UnicaAsrError(`Operation not found: ${operationId}`, "OPERATION_NOT_FOUND");
    }

    const { taskId, config, startedAt } = cached;
    const timeoutMs = config.timeoutMs || 3600000; // 60 минут по умолчанию
    const elapsedMs = Date.now() - startedAt.getTime();

    log("[UnicaASR] Task ID:", taskId);
    log("[UnicaASR] Elapsed time:", Math.round(elapsedMs / 1000), "seconds");
    log("[UnicaASR] Timeout:", Math.round(timeoutMs / 1000), "seconds");

    // Проверка таймаута
    if (elapsedMs > timeoutMs) {
      log("[UnicaASR] ❌ Operation timed out");
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "failed",
        error: "Transcription timeout",
      };
    }

    const task = await this.getTaskStatus(taskId, config);

    log("[UnicaASR] Unica task status:", task.status);

    if (task.status === "Failed") {
      log("[UnicaASR] ❌ Task failed:", task.error || "Unknown error");
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "failed",
        error: task.error || "Unknown error",
      };
    }

    if (task.status === "Completed" && task.resultDatasetId) {
      log("[UnicaASR] ✅ Task completed, fetching dataset...");
      log("[UnicaASR] Result dataset ID:", task.resultDatasetId);
      
      const text = await this.getDatasetText(task.resultDatasetId, config);
      this.operationsCache.delete(operationId);
      
      log("[UnicaASR] ✅ Transcription completed successfully");
      log("[UnicaASR] Final text length:", text.length, "chars");
      log("[UnicaASR] ========================================");
      
      return {
        done: true,
        status: "completed",
        text,
      };
    }

    // Queued или Processing
    const mappedStatus = task.status === "Queued" ? "pending" : "processing";
    log("[UnicaASR] Task status:", mappedStatus, "(waiting...)");
    log("[UnicaASR] ========================================");
    
    return {
      done: false,
      status: mappedStatus,
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

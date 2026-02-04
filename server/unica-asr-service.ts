import { log } from "./vite";
import https from "https";
import type { UnicaAsrConfig } from "../shared/schema";

export function normalizeUnicaApiBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/api")) return trimmed;
  const idx = trimmed.indexOf("/api/");
  if (idx !== -1) return trimmed.slice(0, idx + "/api".length);
  return `${trimmed}/api`;
}

const UNICA_DEFAULT_LANGUAGE = "ru";

async function readJsonOrThrow<T>(
  response: Response,
  meta: { url: string; label: string },
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 400);
    log("[UnicaASR] ❌ Non-JSON response", {
      label: meta.label,
      url: meta.url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      preview,
    });
    throw new UnicaAsrError(
      `Non-JSON response from Unica API (${response.status}): ${preview}`,
      "NON_JSON_RESPONSE",
      response.status,
    );
  }
}

function buildStartRecognitionBodies(opts: {
  filePath: string;
  workspaceId: string;
  language: string;
}): { json: UnicaRecognitionRequest; form: URLSearchParams } {
  const { filePath, workspaceId, language } = opts;
  const json: UnicaRecognitionRequest = {
    // Preferred (observed in validation error response)
    filePath,
    workspaceId,
    processingOptions: {
      language,
    },
    // Legacy/alternate casing
    FilePath: filePath,
    WorkspaceId: workspaceId,
    ProcessingOptions: {
      Language: language,
    },
  };

  const form = new URLSearchParams();
  form.set("filePath", filePath);
  form.set("workspaceId", workspaceId);
  form.set("processingOptions.language", language);

  return { json, form };
}

function buildStartRecognitionUrl(opts: {
  apiBaseUrl: string;
  filePath: string;
  workspaceId: string;
  language: string;
}): string {
  const urlObj = new URL(`${opts.apiBaseUrl}/asr/SpeechRecognition/recognize/async`);
  // Some deployments bind params from query/form rather than JSON body
  urlObj.searchParams.set("filePath", opts.filePath);
  urlObj.searchParams.set("workspaceId", opts.workspaceId);
  urlObj.searchParams.set("processingOptions.language", opts.language);
  return urlObj.toString();
}

function looksLikeUnicaMissingRequiredFieldsResponse(status: number, bodyText: string): boolean {
  if (status !== 400) return false;
  const text = bodyText ?? "";
  // We specifically see: errors.filePath + errors.workspaceId + "required"
  return (
    (text.includes("\"filePath\"") || text.includes("filePath")) &&
    (text.includes("\"workspaceId\"") || text.includes("workspaceId")) &&
    (text.toLowerCase().includes("required") || text.includes("обяз"))
  );
}

// Запрос на транскрибацию
// NOTE: Unica API on some environments expects camelCase keys (filePath/workspaceId/processingOptions).
// We send both camelCase and PascalCase to stay compatible.
export interface UnicaRecognitionRequest {
  // Preferred (observed in validation error response)
  filePath: string;
  workspaceId: string;
  processingOptions: {
    language: string; // "ru"
  };
  // Legacy/alternate
  FilePath?: string;
  WorkspaceId?: string;
  ProcessingOptions?: {
    Language: string; // "ru"
  };
}

// Ответ с задачей транскрибации
export interface UnicaRecognitionTask {
  id: string;
  workspaceId: string;
  status: string; // Возможные значения: Queued, Processing, Completed, Failed, Canceling, Cancelled
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

// HTTPS Agent для игнорирования SSL ошибок
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Retry механизм для fetch с поддержкой skipSslVerify
async function fetchWithRetry(
  url: string,
  options: RequestInit & { agent?: https.Agent },
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options as RequestInit);
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
      executionId?: string; // ID записи в ASR execution log для логирования
      finalResult?: {
        done: boolean;
        status: "pending" | "processing" | "completed" | "failed";
        text?: string;
        error?: string;
        completedAt?: Date;
      };
    }
  > = new Map();
  
  /**
   * Установить executionId для операции (для логирования в ASR execution log)
   */
  setExecutionId(operationId: string, executionId: string): void {
    const cached = this.operationsCache.get(operationId);
    if (cached) {
      cached.executionId = executionId;
      this.operationsCache.set(operationId, cached);
      log("[UnicaASR] ✅ executionId set:", executionId, "for operationId:", operationId);
    } else {
      log("[UnicaASR] ⚠️ setExecutionId failed: operation not in cache:", operationId);
    }
  }
  
  /**
   * Логировать событие в ASR execution log
   */
  private async logEvent(
    executionId: string | undefined,
    stage: string,
    details: Record<string, unknown>
  ): Promise<void> {
    if (!executionId) {
      log("[UnicaASR] ⚠️ logEvent skipped: no executionId for stage:", stage);
      return;
    }
    try {
      const { asrExecutionLogService } = await import("./asr-execution-log-context");
      await asrExecutionLogService.addEvent(executionId, { stage, details });
      log("[UnicaASR] ✅ Event logged:", stage, "executionId:", executionId);
    } catch (err) {
      log("[UnicaASR] Failed to log event:", err);
    }
  }

  /**
   * Запустить асинхронную транскрибацию
   */
  async startRecognition(
    filePath: string,
    config: UnicaAsrConfig
  ): Promise<{ taskId: string; operationId: string }> {
    const apiBaseUrl = normalizeUnicaApiBaseUrl(config.baseUrl);
    const language = UNICA_DEFAULT_LANGUAGE;
    const url = buildStartRecognitionUrl({
      apiBaseUrl,
      filePath,
      workspaceId: config.workspaceId,
      language,
    });

    const bodies = buildStartRecognitionBodies({
      filePath,
      workspaceId: config.workspaceId,
      language,
    });

    log("[UnicaASR] ========== START RECOGNITION ==========");
    log("[UnicaASR] File path:", filePath);
    log("[UnicaASR] Config:", {
      baseUrl: config.baseUrl,
      apiBaseUrl,
      workspaceId: config.workspaceId,
      pollingIntervalMs: config.pollingIntervalMs,
      timeoutMs: config.timeoutMs,
    });
    log("[UnicaASR] POST", url);
    log("[UnicaASR] Request body:", JSON.stringify(bodies.json, null, 2));

    // Используем insecureAgent если skipSslVerify включен
    const agent = config.skipSslVerify ? insecureAgent : undefined;

    const jsonResponse = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(bodies.json),
      agent,
    } as RequestInit & { agent?: https.Agent });

    log("[UnicaASR] Response status:", jsonResponse.status, jsonResponse.statusText);

    let response = jsonResponse;
    if (!response.ok) {
      const errorText = await response.text();
      log("[UnicaASR] ❌ Error response:", errorText);

      // Some environments of Unica ASR appear to NOT bind JSON body (returns "required" for filePath/workspaceId).
      // As a compatibility fallback, retry with application/x-www-form-urlencoded payload.
      if (looksLikeUnicaMissingRequiredFieldsResponse(response.status, errorText)) {
        log("[UnicaASR] Retrying startRecognition as form-urlencoded");

        response = await fetchWithRetry(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Accept: "application/json",
          },
          body: bodies.form.toString(),
          agent,
        } as RequestInit & { agent?: https.Agent });

        log("[UnicaASR] Form retry response status:", response.status, response.statusText);
        if (!response.ok) {
          const retryErrorText = await response.text();
          log("[UnicaASR] ❌ Form retry error response:", retryErrorText);
          throw new UnicaAsrError(
            `Failed to start recognition: ${retryErrorText}`,
            "START_RECOGNITION_FAILED",
            response.status,
          );
        }
      } else {
        throw new UnicaAsrError(
          `Failed to start recognition: ${errorText}`,
          "START_RECOGNITION_FAILED",
          response.status
        );
      }
    }

    const task: UnicaRecognitionTask = await readJsonOrThrow(response, { url, label: "startRecognition" });
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
    const apiBaseUrl = normalizeUnicaApiBaseUrl(config.baseUrl);
    const url = `${apiBaseUrl}/asr/SpeechRecognition/recognition-task/${taskId}?workSpaceId=${config.workspaceId}`;

    log("[UnicaASR] ========== GET TASK STATUS ==========");
    log("[UnicaASR] Task ID:", taskId);
    log("[UnicaASR] GET", url);

    const agent = config.skipSslVerify ? insecureAgent : undefined;
    const response = await fetchWithRetry(url, { method: "GET", headers: { Accept: "application/json" }, agent } as RequestInit & { agent?: https.Agent });

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

    const task = await readJsonOrThrow<UnicaRecognitionTask>(response, { url, label: "getTaskStatus" });
    log("[UnicaASR] ✅ Task status:", task.status);
    log("[UnicaASR] Response body:", JSON.stringify(task, null, 2));
    log("[UnicaASR] ========================================");

    return task;
  }

  /**
   * Получить текст из датасета
   */
  async getDatasetText(datasetId: string, config: UnicaAsrConfig, version: number = 1): Promise<string> {
    const apiBaseUrl = normalizeUnicaApiBaseUrl(config.baseUrl);
    const url = `${apiBaseUrl}/datamanagement/Datasets/${datasetId}?workspaceId=${config.workspaceId}&version=${version}`;

    log("[UnicaASR] ========== GET DATASET TEXT ==========");
    log("[UnicaASR] Dataset ID:", datasetId);
    log("[UnicaASR] Version:", version);
    log("[UnicaASR] GET", url);

    const agent = config.skipSslVerify ? insecureAgent : undefined;
    const response = await fetchWithRetry(url, { method: "GET", headers: { Accept: "application/json" }, agent } as RequestInit & { agent?: https.Agent });

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

    const data: UnicaDatasetResponse = await readJsonOrThrow(response, { url, label: "getDatasetText" });
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
  /**
   * Восстановить операцию из ASR execution log (fallback при потере кэша)
   */
  async tryRestoreFromExecutionLog(operationId: string): Promise<{
    taskId: string;
    config: UnicaAsrConfig;
    startedAt: Date;
    filePath: string;
    executionId?: string;
  } | null> {
    try {
      log("[UnicaASR] Attempting to restore operation from execution log...");
      
      const { asrExecutionLogService } = await import("./asr-execution-log-context");
      const { storage } = await import("./storage");
      
      // Ищем execution по operationId в pipelineEvents
      const executions = await asrExecutionLogService.listExecutions();
      const taskId = operationId.slice("unica_".length);
      
      const execution = executions.find((e) => {
        if (!e.pipelineEvents) return false;
        return e.pipelineEvents.some((evt) => {
          const details: any = (evt as any)?.details ?? null;
          return details?.unicaOperationId === operationId || details?.taskId === taskId;
        });
      });
      
      if (!execution || !execution.chatId) {
        log("[UnicaASR] Execution not found in log");
        return null;
      }
      
      log("[UnicaASR] Found execution:", execution.id, "chatId:", execution.chatId);
      
      // Получаем chat для получения skillId
      const chat = await storage.getChat(execution.chatId);
      if (!chat || !chat.skillId) {
        log("[UnicaASR] Chat or skillId not found");
        return null;
      }
      
      // Получаем skill для config
      const skill = await storage.getSkill(chat.skillId);
      if (!skill || !skill.asrProviderId) {
        log("[UnicaASR] Skill or asrProviderId not found");
        return null;
      }
      
      // Получаем ASR provider config
      const asrProvider = await storage.getAsrProvider(skill.asrProviderId);
      if (!asrProvider || asrProvider.type !== 'unica') {
        log("[UnicaASR] ASR provider not found or not Unica type");
        return null;
      }
      
      const config: UnicaAsrConfig = {
        baseUrl: asrProvider.config.baseUrl || "",
        workspaceId: asrProvider.config.workspaceId || "GENERAL",
        skipSslVerify: asrProvider.config.skipSslVerify || false,
        timeoutMs: 600000, // 10 минут
      };
      
      const restored = {
        taskId,
        config,
        startedAt: execution.startedAt || new Date(),
        filePath: execution.fileName || "restored",
        executionId: execution.id, // Для логирования polling шагов
      };
      
      // Восстанавливаем в кэш
      this.operationsCache.set(operationId, restored);
      log("[UnicaASR] ✅ Operation restored from execution log, executionId:", execution.id);
      
      return restored;
    } catch (err) {
      log("[UnicaASR] Failed to restore from execution log:", err);
      return null;
    }
  }

  async getOperationStatus(operationId: string): Promise<{
    done: boolean;
    status: "pending" | "processing" | "completed" | "failed";
    text?: string;
    error?: string;
  }> {
    log("[UnicaASR] ========== GET OPERATION STATUS ==========");
    log("[UnicaASR] Operation ID:", operationId);

    let cached = this.operationsCache.get(operationId);
    
    // Если операции нет в кэше — пробуем восстановить из ASR execution log
    if (!cached) {
      log("[UnicaASR] ⚠️ Operation not found in cache, attempting restore...");
      const restored = await this.tryRestoreFromExecutionLog(operationId);
      if (restored) {
        cached = restored;
      } else {
        log("[UnicaASR] ❌ Operation not found in cache and could not be restored");
        throw new UnicaAsrError(
          `Операция не найдена. Возможно, сервер был перезапущен. Попробуйте загрузить файл заново.`,
          "OPERATION_NOT_FOUND"
        );
      }
    }

    if (cached.finalResult) {
      return cached.finalResult;
    }

    const { taskId, config, startedAt } = cached;
    const timeoutMs = config.timeoutMs || 600000; // 10 минут по умолчанию (было 60)
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

    let task;
    try {
      task = await this.getTaskStatus(taskId, config);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log("[UnicaASR] ❌ getTaskStatus failed:", errorMessage);
      
      // Логируем ошибку в ASR execution log
      await this.logEvent(cached.executionId, "asr_polling_attempt", {
        taskId,
        elapsedMs,
        error: errorMessage,
        success: false,
      });
      
      throw err;
    }

    log("[UnicaASR] Unica task status:", task.status);
    
    // Логируем каждую попытку polling
    await this.logEvent(cached.executionId, "asr_polling_attempt", {
      taskId,
      taskStatus: task.status,
      elapsedMs,
      resultDatasetId: task.resultDatasetId || null,
      error: task.error || null,
      success: true,
    });

    if (task.status === "Failed") {
      log("[UnicaASR] ❌ Task failed:", task.error || "Unknown error");
      
      // Логируем ошибку
      await this.logEvent(cached.executionId, "asr_error", {
        taskId,
        taskStatus: "Failed",
        error: task.error || "Unknown error",
        elapsedMs,
      });
      
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "failed",
        error: task.error || "Unknown error",
      };
    }

    // Обработка отмены задачи
    if (task.status === "Canceling" || task.status === "Cancelled") {
      log("[UnicaASR] ⚠️ Task cancelled:", task.status);
      
      await this.logEvent(cached.executionId, "asr_error", {
        taskId,
        taskStatus: task.status,
        error: "Задача была отменена",
        elapsedMs,
      });
      
      this.operationsCache.delete(operationId);
      return {
        done: true,
        status: "failed",
        error: `Задача была отменена (${task.status})`,
      };
    }

    if (task.status === "Completed" && task.resultDatasetId) {
      log("[UnicaASR] ✅ Task completed, fetching dataset...");
      log("[UnicaASR] Result dataset ID:", task.resultDatasetId);
      
      let text: string;
      try {
        text = await this.getDatasetText(task.resultDatasetId, config);
        
        // Логируем успешное получение датасета
        await this.logEvent(cached.executionId, "asr_dataset_fetch", {
          datasetId: task.resultDatasetId,
          textLength: text.length,
          success: true,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log("[UnicaASR] ❌ getDatasetText failed:", errorMessage);
        
        // Логируем ошибку
        await this.logEvent(cached.executionId, "asr_dataset_fetch", {
          datasetId: task.resultDatasetId,
          error: errorMessage,
          success: false,
        });
        await this.logEvent(cached.executionId, "asr_error", {
          taskId,
          stage: "dataset_fetch",
          error: errorMessage,
        });
        
        throw err;
      }
      
      cached.finalResult = {
        done: true,
        status: "completed",
        text,
        completedAt: new Date(),
      };
      this.operationsCache.set(operationId, cached);
      
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

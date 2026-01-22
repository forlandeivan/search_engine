import { speechProviderService, SpeechProviderDisabledError } from "./speech-provider-service";
import { yandexIamTokenService } from "./yandex-iam-token-service";
import { yandexObjectStorageService, ObjectStorageError, ObjectStorageCredentials } from "./yandex-object-storage-service";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { parseBuffer } from "music-metadata";
import { tmpdir } from "os";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import fetch from "node-fetch";
import type { ChatMessageMetadata, TranscriptStatus } from "@shared/schema";
import { workspaceOperationGuard } from "./guards/workspace-operation-guard";
import { OperationBlockedError, mapDecisionToPayload } from "./guards/errors";
import { buildAsrOperationContext } from "./guards/helpers";
import { ensureModelAvailable, ModelInactiveError, ModelValidationError, ModelUnavailableError } from "./model-service";
import { measureUsageForModel, type UsageMeasurement } from "./consumption-meter";
import { calculatePriceForUsage } from "./price-calculator";
import { estimateAsrPreflight } from "./preflight-estimator";
import { assertSufficientWorkspaceCredits, InsufficientCreditsError } from "./credits-precheck";
import { recordAsrUsageEvent } from "./usage/usage-service";
import { applyIdempotentUsageCharge } from "./idempotent-charge-service";
import { db } from "./db";
import { models } from "@shared/schema";
import { and, eq } from "drizzle-orm";

const createHttpProxyAgent = (url: string) => {
  try {
    const HttpProxyAgentModule = require("http-proxy-agent");
    return new HttpProxyAgentModule(url);
  } catch {
    return undefined;
  }
};

const createHttpsProxyAgent = (url: string) => {
  try {
    const HttpsProxyAgentModule = require("https-proxy-agent");
    return new HttpsProxyAgentModule(url);
  } catch {
    return undefined;
  }
};

export class YandexSttAsyncError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "YandexSttAsyncError";
    this.status = status;
    this.code = code;
  }
}

export class YandexSttAsyncConfigError extends YandexSttAsyncError {
  constructor(message: string) {
    super(message, 400, "CONFIG_ERROR");
    this.name = "YandexSttAsyncConfigError";
  }
}

const YANDEX_ASYNC_STT_ENDPOINT = "https://transcribe.api.cloud.yandex.net/speech/stt/v2/longRunningRecognize";
const YANDEX_OPERATION_ENDPOINT = "https://operation.api.cloud.yandex.net/operations";

interface TranscriptionOperation {
  id: string;
  userId: string;
  operationId: string;
  objectKey?: string;
  bucketName?: string;
  createdAt: Date;
  status: "pending" | "completed" | "failed";
  result?: { text: string; lang: string };
  error?: string;
  chatId?: string;
  transcriptId?: string;
  executionId?: string;
  workspaceId?: string;
  providerId?: string;
  modelKey?: string | null;
  modelId?: string | null;
  durationSeconds?: number | null;
  usageRecorded?: boolean;
  creditsPerUnit?: number | null;
}

const operationsCache = new Map<string, TranscriptionOperation>();
// TODO(asr-usage): фактическая длительность аудио пока не сохраняется.
// При учёте ASR usage нужно на этапе загрузки или завершения операции вычислять duration_ms
// и прокидывать её в asrExecution + usage (workspaceId есть в чате/transcript, длительность в ответе Yandex не приходит).

setInterval(() => {
  const now = Date.now();
  for (const [key, op] of operationsCache.entries()) {
    if (now - op.createdAt.getTime() > 24 * 60 * 60 * 1000) {
      operationsCache.delete(key);
    }
  }
}, 60 * 60 * 1000);

function needsConversion(mimeType: string): boolean {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  // Конвертируем всё, что не OGG/OPUS, в OGG для совместимости с async STT.
  return baseMimeType !== "audio/ogg" && baseMimeType !== "audio/opus";
}

async function findAsrModelForProvider(providerId: string): Promise<{ id: string; key: string; creditsPerUnit: number } | null> {
  const rows = await db
    .select({
      id: models.id,
      key: models.modelKey,
      creditsPerUnit: models.creditsPerUnit,
    })
    .from(models)
    .where(and(eq(models.providerId, providerId), eq(models.modelType, "ASR"), eq(models.isActive, true)))
    .limit(1);

  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    key: rows[0].key,
    creditsPerUnit: rows[0].creditsPerUnit ?? 0,
  };
}

async function probeAudioDurationSeconds(audioBuffer: Buffer): Promise<number | null> {
  const executable = ffmpegPath || "ffmpeg";

  // 0) Попробуем распарсить контейнер без внешних бинарников.
  try {
    const meta = await parseBuffer(audioBuffer, undefined, { duration: true });
    const mmDuration = meta.format.duration;
    if (mmDuration && Number.isFinite(mmDuration) && mmDuration > 0) {
      return Math.max(0, Math.round(mmDuration));
    }
  } catch {
    // ignore, идём дальше
  }

  // 1) Пытаемся через ffprobe (корректнее и быстрее).
  const tryFfprobe = async (): Promise<number | null> => {
    return new Promise<number | null>((resolve) => {
      try {
        const ffprobe = spawn(executable.replace(/ffmpeg$/i, "ffprobe"), [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          "-i",
          "pipe:0",
        ]);
        let stdout = "";
        ffprobe.stdout.on("data", (data) => {
          stdout += data.toString();
        });
        ffprobe.on("close", () => {
          const duration = Number(stdout.trim());
          if (!Number.isFinite(duration) || duration <= 0) {
            resolve(null);
            return;
          }
          resolve(Math.max(0, Math.round(duration)));
        });
        ffprobe.on("error", () => resolve(null));
        ffprobe.stdin.write(audioBuffer);
        ffprobe.stdin.end();
      } catch {
        resolve(null);
      }
    });
  };

  // 2) Fallback через ffmpeg stderr (как было раньше).
  const tryFfmpeg = async (): Promise<number | null> =>
    new Promise<number | null>((resolve) => {
      try {
        const ffmpeg = spawn(executable, ["-i", "pipe:0", "-f", "null", "-"]);
        let stderr = "";
        ffmpeg.stderr.on("data", (data) => {
          stderr += data.toString();
        });
        ffmpeg.on("close", () => {
          const match = /Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d{2})/.exec(stderr);
          if (!match) {
            resolve(null);
            return;
          }
          const hours = Number(match[1]);
          const minutes = Number(match[2]);
          const seconds = Number(match[3]);
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          resolve(Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : null);
        });
        ffmpeg.on("error", () => resolve(null));
        ffmpeg.stdin.write(audioBuffer);
        ffmpeg.stdin.end();
      } catch {
        resolve(null);
      }
    });

  const viaFfprobe = await tryFfprobe();
  if (viaFfprobe && viaFfprobe > 0) {
    return viaFfprobe;
  }
  return await tryFfmpeg();
}

function getMimeTypeExtension(mimeType: string): string {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  if (baseMimeType === "audio/mp3" || baseMimeType === "audio/mpeg") return "mp3";
  if (baseMimeType === "audio/wav" || baseMimeType === "audio/wave") return "wav";
  if (baseMimeType === "audio/webm") return "webm";
  if (baseMimeType === "audio/ogg") return "ogg";
  return "unknown";
}

export async function convertAudioToOgg(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<Buffer> {
  const tempId = randomBytes(8).toString("hex");
  const inputExt = getMimeTypeExtension(mimeType);
  const inputPath = join(tmpdir(), `input_${tempId}.${inputExt}`);
  const outputPath = join(tmpdir(), `output_${tempId}.ogg`);
  const executable = ffmpegPath || "ffmpeg";

  try {
    await writeFile(inputPath, audioBuffer);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(executable, [
        "-i", inputPath,
        "-c:a", "libopus",
        "-b:a", "48k",
        "-ar", "48000",
        "-ac", "1",
        "-y",
        outputPath
      ]);

      let stderr = "";
      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`Failed to start FFmpeg: ${err.message}`));
      });
    });

    const outputBuffer = await readFile(outputPath);
    console.info(`[yandex-stt-async] Converted WebM to OGG: ${audioBuffer.length} -> ${outputBuffer.length} bytes`);
    return outputBuffer;
  } finally {
    try {
      await unlink(inputPath);
    } catch {}
    try {
      await unlink(outputPath);
    } catch {}
  }
}

export interface AsyncTranscribeOptions {
  audioBuffer: Buffer;
  mimeType: string;
  lang?: string;
  userId: string;
  workspaceId: string;
  originalFileName?: string;
  chatId?: string;
  transcriptId?: string;
  executionId?: string;
}

type AsyncUploadResult = {
  attachmentId?: string;
  objectKey?: string;
  fileName?: string | null;
  downloadUrl?: string | null;
  expiresAt?: string | Date | null;
  sizeBytes?: number | null;
};

export interface AsyncTranscribeResponse {
  operationId: string;
  message: string;
  uploadResult?: AsyncUploadResult;
  durationSeconds?: number | null;
}

export interface TranscribeOperationStatus {
  operationId: string;
  status: "pending" | "completed" | "failed";
  result?: { text: string; lang: string };
  /** Shorthand for result?.text */
  text?: string;
  error?: string;
  chatId?: string;
  transcriptId?: string;
  executionId?: string;
  durationSeconds?: number | null;
  usageMinutes?: number | null;
}

interface SecretValues {
  serviceAccountKey?: string;
  folderId?: string;
  apiKey?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3BucketName?: string;
}

class YandexSttAsyncService {
  async startAsyncTranscription(options: AsyncTranscribeOptions): Promise<AsyncTranscribeResponse> {
    const startTime = Date.now();
    let { audioBuffer, mimeType, userId, workspaceId, originalFileName, chatId, transcriptId, executionId } = options;

    console.info(`[yandex-stt-async] [START] Starting transcription pipeline`, {
      fileSize: audioBuffer.length,
      mimeType,
      userId,
      workspaceId,
      chatId,
      transcriptId,
    });

    const providerDetail = await speechProviderService.getActiveSttProviderOrThrow();
    const { provider, secrets } = providerDetail;
    const config = providerDetail.config as Record<string, string | boolean | undefined>;

    if (!secrets.folderId?.isSet) {
      throw new YandexSttAsyncConfigError("Folder ID Yandex Cloud не настроен. Установите его в настройках провайдера.");
    }
    if (!secrets.serviceAccountKey?.isSet) {
      throw new YandexSttAsyncConfigError("Service Account Key не настроен. Требуется для асинхронного API. Установите его в настройках провайдера.");
    }

    if (!secrets.s3AccessKeyId?.isSet || !secrets.s3SecretAccessKey?.isSet || !secrets.s3BucketName?.isSet) {
      throw new YandexSttAsyncConfigError(
        "Не настроен Object Storage. Для транскрибации больших файлов (>1 МБ) требуется настроить Access Key ID, Secret Access Key и имя бакета в настройках провайдера."
      );
    }

    const secretValues = await this.getSecretValues(provider.id);
    const { serviceAccountKey, folderId, s3AccessKeyId, s3SecretAccessKey, s3BucketName } = secretValues;

    if (!serviceAccountKey || !folderId) {
      throw new YandexSttAsyncConfigError("Service Account Key или Folder ID отсутствуют в хранилище секретов.");
    }

    if (!s3AccessKeyId || !s3SecretAccessKey || !s3BucketName) {
      throw new YandexSttAsyncConfigError("Не все учетные данные Object Storage настроены.");
    }

    const providerConfig = config && typeof config === "object" && !Array.isArray(config) ? config as Record<string, unknown> : {};
    let asrModelKey = ("model" in providerConfig && typeof providerConfig.model === "string" ? providerConfig.model : null) ?? null;
    let asrModelId: string | null = null;
    let asrCreditsPerUnit: number | null = null;
    if (asrModelKey) {
      try {
        const model = await ensureModelAvailable(asrModelKey, { expectedType: "ASR" });
        asrModelId = model.id;
        asrCreditsPerUnit = model.creditsPerUnit ?? null;
      } catch (error) {
        if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
          throw new YandexSttAsyncConfigError(error.message);
        }
        throw error;
      }
    } else {
      // fallback: берём активную ASR модель провайдера
      const found = await findAsrModelForProvider(provider.id);
      if (found) {
        asrModelKey = found.key;
        asrModelId = found.id;
        asrCreditsPerUnit = found.creditsPerUnit;
      }
    }

    const audioDurationSeconds = await probeAudioDurationSeconds(audioBuffer);
    if (!audioDurationSeconds || audioDurationSeconds <= 0) {
      console.warn("[yandex-stt-async] audio duration probe returned empty result; will rely on fallback timing");
    } else {
      console.info(`[yandex-stt-async] [PROBE] Audio duration: ${audioDurationSeconds}s, elapsed: ${Date.now() - startTime}ms`);
    }

    const guardDecision = await workspaceOperationGuard.check(
      buildAsrOperationContext({
        workspaceId,
        providerId: provider.id,
        model: asrModelKey,
        modelId: asrModelId,
        modelKey: asrModelKey,
        mediaType: "audio",
        durationSeconds: audioDurationSeconds ?? undefined,
      }),
    );
    if (!guardDecision.allowed) {
      throw new OperationBlockedError(
        mapDecisionToPayload(guardDecision, {
          workspaceId,
          operationType: "ASR_TRANSCRIPTION",
          meta: { asr: { provider: provider.id, model: asrModelKey, modelId: asrModelId, modelKey: asrModelKey } },
        }),
      );
    }

    // Preflight credits check
    try {
      const estimate = estimateAsrPreflight(
        { consumptionUnit: "MINUTES" as const, creditsPerUnit: asrCreditsPerUnit ?? 0 },
        { durationSeconds: audioDurationSeconds ?? 0 },
      );
      await assertSufficientWorkspaceCredits(workspaceId, estimate.estimatedCreditsCents, {
        modelKey: asrModelKey,
        modelId: asrModelId,
        unit: estimate.unit,
        estimatedUnits: estimate.estimatedUnits,
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        throw new YandexSttAsyncError(error.message, error.status, error.code);
      }
      throw error;
    }

    let iamToken: string;
    try {
      iamToken = await yandexIamTokenService.getIamToken(serviceAccountKey);
    } catch (error) {
      throw new YandexSttAsyncConfigError(
        `Не удалось получить IAM токен: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (needsConversion(mimeType)) {
      const conversionStartTime = Date.now();
      try {
        console.info(`[yandex-stt-async] [CONVERT-START] Converting ${mimeType} to OGG, elapsed: ${Date.now() - startTime}ms`);
        audioBuffer = await convertAudioToOgg(audioBuffer, mimeType);
        mimeType = "audio/ogg";
        console.info(`[yandex-stt-async] [CONVERT-DONE] Conversion took ${Date.now() - conversionStartTime}ms, total elapsed: ${Date.now() - startTime}ms`);
      } catch (conversionError) {
        console.error("[yandex-stt-async] Conversion failed:", conversionError);
        throw new YandexSttAsyncError(
          "Не удалось конвертировать аудио формат. Попробуйте использовать другой браузер.",
          400,
          "CONVERSION_ERROR"
        );
      }
    }

    const lang = options.lang ?? (config.languageCode as string) ?? "ru-RU";

    console.info(`[yandex-stt-async] [UPLOAD-START] Uploading to S3: ${audioBuffer.length} bytes, lang=${lang}, elapsed: ${Date.now() - startTime}ms`);

    const s3Credentials: ObjectStorageCredentials = {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      bucketName: s3BucketName,
    };

    let uploadResult;
    const uploadStartTime = Date.now();
    try {
      uploadResult = await yandexObjectStorageService.uploadAudioFile(
        audioBuffer,
        mimeType,
        s3Credentials,
        originalFileName
      );
      console.info(`[yandex-stt-async] [UPLOAD-DONE] File uploaded to S3: ${uploadResult.uri}, took ${Date.now() - uploadStartTime}ms, total elapsed: ${Date.now() - startTime}ms`);
    } catch (error) {
      if (error instanceof ObjectStorageError) {
        throw new YandexSttAsyncError(error.message, 500, error.code);
      }
      throw new YandexSttAsyncError(
        `Ошибка загрузки файла в Object Storage: ${error instanceof Error ? error.message : String(error)}`,
        500,
        "UPLOAD_ERROR"
      );
    }

    try {
      const httpProxyAgent = process.env.HTTP_PROXY ? createHttpProxyAgent(process.env.HTTP_PROXY) : undefined;
      const httpsProxyAgent = process.env.HTTPS_PROXY ? createHttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;

      const requestBody = {
        config: {
          specification: {
            languageCode: lang,
            model: (config.model as string) || "general",
            profanityFilter: false,
            literatureText: config.enablePunctuation !== false,
            rawResults: false,
          },
        },
        audio: {
          uri: uploadResult.uri,
        },
      };

      console.info(`[yandex-stt-async] [API-START] Sending async STT request with URI: ${uploadResult.uri}, elapsed: ${Date.now() - startTime}ms`);

      const apiStartTime = Date.now();
      const response = await fetch(YANDEX_ASYNC_STT_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${iamToken}`,
          "Content-Type": "application/json",
          "x-folder-id": folderId,
        },
        body: JSON.stringify(requestBody),
        agent: YANDEX_ASYNC_STT_ENDPOINT.startsWith("https") ? httpsProxyAgent : httpProxyAgent,
      } as Parameters<typeof fetch>[1]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[yandex-stt-async] API error: ${response.status} - ${errorText}`);

        try {
          await yandexObjectStorageService.deleteFile(uploadResult.objectKey, s3Credentials);
        } catch {}

        if (response.status === 401 || response.status === 403) {
          throw new YandexSttAsyncError(
            "Ошибка аутентификации Yandex SpeechKit. Проверьте IAM токен и права доступа.",
            response.status,
            "AUTH_ERROR"
          );
        }
        if (response.status === 400) {
          throw new YandexSttAsyncError(
            `Некорректный запрос к Yandex SpeechKit: ${errorText}`,
            response.status,
            "BAD_REQUEST"
          );
        }
        throw new YandexSttAsyncError(
          `Ошибка Yandex SpeechKit: ${response.status} - ${errorText}`,
          response.status,
          "API_ERROR"
        );
      }

      const operationResponse = await response.json() as { id?: string };

      console.info(`[yandex-stt-async] [API-DONE] Received operation ID, API call took ${Date.now() - apiStartTime}ms, total elapsed: ${Date.now() - startTime}ms`);

      if (!operationResponse.id) {
        try {
          await yandexObjectStorageService.deleteFile(uploadResult.objectKey, s3Credentials);
        } catch {}
        throw new YandexSttAsyncError("Не получен ID операции от Yandex", 500, "NO_OPERATION_ID");
      }

      const operationId = operationResponse.id;
      const cacheId = `${userId}_${operationId}`;

      operationsCache.set(cacheId, {
        id: cacheId,
        userId,
        operationId,
        objectKey: uploadResult.objectKey,
        bucketName: uploadResult.bucketName,
        createdAt: new Date(),
        status: "pending",
        workspaceId,
        providerId: provider.id,
        modelKey: asrModelKey,
        modelId: asrModelId,
        creditsPerUnit: asrCreditsPerUnit,
        durationSeconds: audioDurationSeconds ?? null,
        usageRecorded: false,
        chatId,
        transcriptId,
        executionId,
      });

      console.info(`[yandex-stt-async] [SUCCESS] Transcription started, operationId: ${operationId}, total time: ${Date.now() - startTime}ms`, {
        operationId,
        transcriptId,
        chatId,
        durationSeconds: audioDurationSeconds,
      });

      return {
        operationId,
        message: "Транскрибация началась. Пожалуйста, дождитесь завершения.",
        uploadResult,
        durationSeconds: audioDurationSeconds ?? null,
      };
    } catch (error) {
      if (error instanceof YandexSttAsyncError || error instanceof SpeechProviderDisabledError) {
        throw error;
      }
      console.error("[yandex-stt-async] Network error:", error);

      try {
        await yandexObjectStorageService.deleteFile(uploadResult.objectKey, s3Credentials);
      } catch {}

      throw new YandexSttAsyncError(
        `Ошибка сети при обращении к Yandex SpeechKit: ${error instanceof Error ? error.message : String(error)}`,
        503,
        "NETWORK_ERROR"
      );
    }
  }

  async getOperationStatus(userId: string, operationId: string): Promise<TranscribeOperationStatus> {
    const pollStartTime = Date.now();
    const cacheId = `${userId}_${operationId}`;
    const cached = operationsCache.get(cacheId);

    if (!cached) {
      console.warn(`[yandex-stt-async] [POLL] Operation not found in cache: ${operationId}`);
      throw new YandexSttAsyncError("Операция не найдена", 404, "NOT_FOUND");
    }

    if (cached.status !== "pending") {
      console.info(`[yandex-stt-async] [POLL] Operation already completed: ${operationId}, status: ${cached.status}`);
      return {
        operationId,
        status: cached.status,
        result: cached.result,
        error: cached.error,
        chatId: cached.chatId,
        transcriptId: cached.transcriptId,
        executionId: cached.executionId,
      };
    }

    try {
      const providerDetail = await speechProviderService.getActiveSttProviderOrThrow();
      const secretValues = await this.getSecretValues(providerDetail.provider.id);
      const { serviceAccountKey, s3AccessKeyId, s3SecretAccessKey, s3BucketName } = secretValues;

      if (!serviceAccountKey) {
        throw new YandexSttAsyncError("Service Account Key отсутствует", 500, "NO_KEY");
      }

      const iamToken = await yandexIamTokenService.getIamToken(serviceAccountKey);

      const age = Date.now() - (cached.createdAt ? cached.createdAt.getTime() : 0);
      console.info(`[yandex-stt-async] [POLL-CHECK] Checking operation status, age: ${Math.round(age / 1000)}s, operationId: ${operationId}`);

      const httpProxyAgent = process.env.HTTP_PROXY ? createHttpProxyAgent(process.env.HTTP_PROXY) : undefined;
      const httpsProxyAgent = process.env.HTTPS_PROXY ? createHttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;

      const response = await fetch(`${YANDEX_OPERATION_ENDPOINT}/${operationId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${iamToken}`,
        },
        agent: YANDEX_OPERATION_ENDPOINT.startsWith("https") ? httpsProxyAgent : httpProxyAgent,
      } as Parameters<typeof fetch>[1]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[yandex-stt-async] Operation check error: ${response.status} - ${errorText}`);

      if (response.status === 404) {
        cached.status = "failed";
        cached.error = "Операция не найдена на сервере Yandex";
        await this.updateTranscriptAndMessage(cached.objectKey, "failed", undefined, cached.error);
        await this.cleanupOperationFile(cached, s3AccessKeyId, s3SecretAccessKey, s3BucketName);
        if (cached.executionId) {
          const { asrExecutionLogService } = await import("./asr-execution-log-context");
          await asrExecutionLogService.addEvent(
            cached.executionId,
            {
              stage: "asr_result_error",
              details: {
                provider: "yandex_speechkit",
                operationId,
                errorMessage: "Операция не найдена на сервере Yandex",
              },
            },
            "failed",
            { message: "Операция не найдена на сервере Yandex" },
          );
        }
        return {
          operationId,
          status: "failed",
          error: "Операция не найдена на сервере Yandex",
          chatId: cached.chatId,
          transcriptId: cached.transcriptId,
          executionId: cached.executionId,
        };
      }

        throw new YandexSttAsyncError(`Ошибка при проверке статуса: ${response.status}`, response.status, "CHECK_ERROR");
      }

      const operationData = await response.json() as {
        done?: boolean;
        error?: { message: string; code: number };
        response?: { chunks: Array<{ alternatives: Array<{ text: string; confidence?: number }> }> };
      };

      console.info(`[yandex-stt-async] [POLL-RESULT] Operation status received, done: ${operationData.done}, hasError: ${Boolean(operationData.error)}, pollTime: ${Date.now() - pollStartTime}ms`);

      if (operationData.error) {
        cached.status = "failed";
        cached.error = operationData.error.message;
        await this.updateTranscriptAndMessage(cached.objectKey, "failed", undefined, operationData.error.message);
        await this.cleanupOperationFile(cached, s3AccessKeyId, s3SecretAccessKey, s3BucketName);
        if (cached.executionId) {
          const { asrExecutionLogService } = await import("./asr-execution-log-context");
          await asrExecutionLogService.addEvent(
            cached.executionId,
            {
              stage: "asr_result_error",
              details: {
                provider: "yandex_speechkit",
                operationId,
                errorMessage: operationData.error.message,
                errorCode: String(operationData.error.code ?? ""),
              },
            },
            "failed",
            { code: String(operationData.error.code ?? ""), message: operationData.error.message },
          );
        }
        return {
          operationId,
          status: "failed",
          error: operationData.error.message,
        };
      }

      if (operationData.done && operationData.response) {
        const extractStartTime = Date.now();
        const chunks = operationData.response.chunks || [];
        
        console.info(`[yandex-stt-async] [EXTRACT-START] Extracting text from ${chunks.length} chunks, operationId: ${operationId}`);
        
        const text = chunks
          .map((chunk) => {
            const alternatives = chunk.alternatives || [];
            if (alternatives.length === 0) return "";
            // Возьми альтернативу с наивысшей confidence или первую если confidence не задана
            const best = alternatives.reduce((best, alt) => {
              const altObj = alt && typeof alt === "object" && !Array.isArray(alt) ? alt as Record<string, unknown> : {};
              const bestObj = best && typeof best === "object" && !Array.isArray(best) ? best as Record<string, unknown> : {};
              const altConf = typeof altObj.confidence === "number" ? altObj.confidence : 0;
              const bestConf = typeof bestObj.confidence === "number" ? bestObj.confidence : 0;
              return altConf > bestConf ? alt : best;
            });
            const bestResultObj = best && typeof best === "object" && !Array.isArray(best) ? best as Record<string, unknown> : {};
            return (typeof bestResultObj.text === "string" ? bestResultObj.text : "") || "";
          })
          .filter(text => text.length > 0)
          .join(" ")
          .trim();

        console.info(`[yandex-stt-async] [EXTRACT-DONE] Text extracted: ${text.length} chars, took ${Date.now() - extractStartTime}ms`);

        cached.status = "completed";
        cached.result = { text, lang: "ru-RU" };
        // NOTE: Do NOT set chatId or executionId from operationId - operationId is Yandex's ID, not a UUID

        // Подготавливаем контекст для авто-действия (если оно включено у навыка)
        const { storage } = await import("./storage");
        const { getSkillById } = await import("./skills");
        const transcriptForContext =
          cached.transcriptId && cached.transcriptId.trim().length > 0
            ? await storage.getTranscriptById(cached.transcriptId)
            : cached.objectKey
              ? await storage.getTranscriptBySourceFileId(cached.objectKey)
              : undefined;
        const chatForContext =
          transcriptForContext && transcriptForContext.chatId
            ? await storage.getChatSessionById(transcriptForContext.chatId)
            : cached.chatId
              ? await storage.getChatSessionById(cached.chatId)
              : undefined;
        const skillForContext =
          chatForContext?.skillId && chatForContext.workspaceId
            ? await getSkillById(chatForContext.workspaceId, chatForContext.skillId)
            : null;
        const autoActionEnabled =
          Boolean(
            skillForContext &&
              skillForContext.onTranscriptionMode === "auto_action" &&
              skillForContext.onTranscriptionAutoActionId,
          ) && Boolean(transcriptForContext);

        const initialStatus: TranscriptStatus = autoActionEnabled ? "postprocessing" : "ready";
        await this.updateTranscriptAndMessage(cached.objectKey, initialStatus, text);
        await this.cleanupOperationFile(cached, s3AccessKeyId, s3SecretAccessKey, s3BucketName);

        const age = Date.now() - (cached.createdAt ? cached.createdAt.getTime() : 0);
        console.info(`[yandex-stt-async] [COMPLETED] Operation completed: ${operationId}, chunks: ${chunks.length}, text: ${text.length} chars, totalAge: ${Math.round(age / 1000)}s, autoAction: ${autoActionEnabled}`);

        // Логируем в журнал ASR
        if (cached.executionId) {
          const { asrExecutionLogService } = await import("./asr-execution-log-context");
          const previewText = text.slice(0, 200);
          await asrExecutionLogService.addEvent(cached.executionId, {
            stage: "asr_result_final",
            details: { provider: "yandex_speechkit", operationId, previewText },
          });
        }

        // Учёт usage (MINUTES) — используем измеренную длительность, если доступна.
        if (!cached.usageRecorded && cached.workspaceId) {
        let durationSeconds = cached.durationSeconds ?? null;
        if ((!durationSeconds || durationSeconds <= 0) && cached.createdAt) {
          const fallbackSeconds = Math.round((Date.now() - cached.createdAt.getTime()) / 1000);
          if (fallbackSeconds > 0) {
            durationSeconds = fallbackSeconds;
            cached.durationSeconds = fallbackSeconds;
            operationsCache.set(cacheId, cached);
          }
        }
        if (durationSeconds !== null && durationSeconds !== undefined && durationSeconds > 0) {
            try {
              // Уточняем цену из модели, если при старте не было creditsPerUnit.
              let creditsPerUnit = cached.creditsPerUnit ?? 0;
              if ((!creditsPerUnit || creditsPerUnit <= 0) && (cached.modelId || cached.modelKey)) {
                try {
                  const model = await ensureModelAvailable(cached.modelId ?? cached.modelKey!, {
                    expectedType: "ASR",
                    requireActive: false,
                  });
                  creditsPerUnit = model.creditsPerUnit ?? 0;
                  cached.creditsPerUnit = creditsPerUnit;
                  operationsCache.set(cacheId, cached);
                } catch (resolveErr) {
                  console.warn("[usage][asr] unable to resolve model creditsPerUnit", resolveErr);
                }
              } else if ((!creditsPerUnit || creditsPerUnit <= 0) && cached.providerId) {
                const found = await findAsrModelForProvider(cached.providerId);
                if (found) {
                  creditsPerUnit = found.creditsPerUnit ?? 0;
                  cached.creditsPerUnit = creditsPerUnit;
                  cached.modelId = cached.modelId ?? found.id;
                  cached.modelKey = cached.modelKey ?? found.key;
                  operationsCache.set(cacheId, cached);
                }
              }

              const measurement: UsageMeasurement = measureUsageForModel(
                { consumptionUnit: "MINUTES" },
                { kind: "SECONDS", seconds: durationSeconds },
                {
                  provider: "yandex_speechkit",
                  operationId,
                },
              );
              const appliedCreditsPerUnitCents = Math.max(0, Math.trunc(creditsPerUnit ?? 0));
              const creditsChargedCents = Math.max(0, Math.round((appliedCreditsPerUnitCents * durationSeconds) / 60));
              const price = {
                creditsChargedCents,
                appliedCreditsPerUnitCents,
                unit: measurement.unit,
                quantityUnits: measurement.quantityUnits,
                quantityRaw: measurement.quantityRaw,
              };
              const chargeOperationId = cached.executionId ?? operationId;
              if (chargeOperationId) {
                try {
                  await applyIdempotentUsageCharge({
                    workspaceId: cached.workspaceId,
                    operationId: chargeOperationId,
                    model: {
                      id: cached.modelId ?? null,
                      key: cached.modelKey ?? null,
                      name: cached.modelKey ?? null,
                      type: "ASR",
                      consumptionUnit: "MINUTES",
                    },
                    measurement,
                    price,
                    metadata: {
                      source: "asr_transcription",
                      fileName: undefined,
                      provider: "yandex_speechkit",
                    },
                  });
                  console.info(
                    `[usage][asr] charged ${price.creditsChargedCents} cents for ${measurement.quantityUnits} minute(s) (${measurement.quantityRaw}s)`,
                  );
                } catch (chargeError) {
                  console.error("[billing] Failed to apply idempotent ASR charge:", chargeError);
                }
              }
              await recordAsrUsageEvent({
                workspaceId: cached.workspaceId,
                asrJobId: cached.executionId ?? operationId,
                durationSeconds: measurement.quantityRaw,
                provider: "yandex_speechkit",
                model: cached.modelKey ?? null,
                modelId: cached.modelId ?? null,
                appliedCreditsPerUnit: price.appliedCreditsPerUnitCents,
                creditsCharged: price.creditsChargedCents,
                occurredAt: new Date(),
              });
              cached.usageRecorded = true;
              operationsCache.set(cacheId, cached);
              if (cached.executionId) {
                const { asrExecutionLogService } = await import("./asr-execution-log-context");
                await asrExecutionLogService.updateExecution(cached.executionId, {
                  durationMs: measurement.quantityRaw * 1000,
                });
              }
            } catch (error) {
              console.error("[usage][asr] Failed to record ASR usage:", error);
            }
          } else {
            console.warn("[usage][asr] durationSeconds is unavailable; skipping usage record", {
              operationId,
              workspaceId: cached.workspaceId,
            });
          }
        }

        // Авто-действие (если настроено)
        if (autoActionEnabled && transcriptForContext && chatForContext && skillForContext) {
          await this.applyAutoActionForTranscript({
            transcript: transcriptForContext,
            chat: chatForContext,
            skill: skillForContext,
            fullText: text,
            executionId: cached.executionId ?? null,
            operationId,
          });
        } else {
          // Обычное завершение без авто-действия
          const transcriptId =
            transcriptForContext?.id ??
            (cached.transcriptId ? cached.transcriptId : undefined) ??
            null;
          let transcriptMessageId: string | null = null;
          if (transcriptId) {
            const message = await storage.findChatMessageByTranscriptId(transcriptId);
            transcriptMessageId = message?.id ?? null;
          }
          if (cached.executionId) {
            const { asrExecutionLogService } = await import("./asr-execution-log-context");
            if (transcriptId) {
              await asrExecutionLogService.addEvent(cached.executionId, {
                stage: "transcript_saved",
                details: { transcriptId },
              });
            }
            if (transcriptMessageId || transcriptId) {
              await asrExecutionLogService.addEvent(cached.executionId, {
                stage: "transcript_preview_message_created",
                details: { messageId: transcriptMessageId, transcriptId },
              });
            }
            await asrExecutionLogService.updateExecution(cached.executionId, {
              status: "success",
              finishedAt: new Date(),
              transcriptId: transcriptId ?? null,
              transcriptMessageId,
            });
          }
        }

        return {
          operationId,
          status: "completed",
          result: { text, lang: "ru-RU" },
          text, // shorthand
          chatId: cached.chatId,
          transcriptId: transcriptForContext?.id ?? cached.transcriptId,
          executionId: cached.executionId,
          durationSeconds: cached.durationSeconds ?? null,
          usageMinutes:
            cached.durationSeconds && cached.durationSeconds > 0 ? Math.ceil(cached.durationSeconds / 60) : null,
        };
      }

      return {
        operationId,
        status: "pending",
        chatId: cached.chatId,
        transcriptId: cached.transcriptId,
        executionId: cached.executionId,
        durationSeconds: cached.durationSeconds ?? null,
        usageMinutes:
          cached.durationSeconds && cached.durationSeconds > 0 ? Math.ceil(cached.durationSeconds / 60) : null,
      };
    } catch (error) {
      if (error instanceof YandexSttAsyncError) {
        throw error;
      }
      console.error("[yandex-stt-async] Status check error:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const { asrExecutionLogService } = await import("./asr-execution-log-context");
      const cacheId = `${userId}_${operationId}`;
      const cached = operationsCache.get(cacheId);
      if (cached?.executionId) {
        await asrExecutionLogService.addEvent(
          cached.executionId,
          {
            stage: "asr_result_error",
            details: { provider: "yandex_speechkit", operationId, errorMessage: errMsg },
          },
          "failed",
          { message: errMsg },
        );
      }
      throw new YandexSttAsyncError(
        `Ошибка при проверке статуса операции: ${error instanceof Error ? error.message : String(error)}`,
        503,
        "CHECK_ERROR"
      );
    }
  }

  setOperationContext(
    userId: string,
    operationId: string,
    context: { chatId?: string; transcriptId?: string; executionId?: string },
  ): void {
    const cacheId = `${userId}_${operationId}`;
    const cached = operationsCache.get(cacheId);
    if (!cached) {
      return;
    }
    if (context.chatId) {
      cached.chatId = context.chatId;
    }
    if (context.transcriptId) {
      cached.transcriptId = context.transcriptId;
    }
    if (context.executionId) {
      cached.executionId = context.executionId;
    }
    operationsCache.set(cacheId, cached);
  }

  private async applyAutoActionForTranscript(params: {
    transcript: import("@shared/schema").Transcript;
    chat: import("@shared/schema").ChatSession;
    skill: import("@shared/skills").SkillDto;
    fullText: string;
    executionId: string | null;
    operationId: string;
  }): Promise<void> {
    const { transcript, chat, skill, fullText, executionId, operationId } = params;
    const { storage } = await import("./storage");
    const { actionsRepository } = await import("./actions");
    const { skillActionsRepository } = await import("./skill-actions");
    const { resolveLlmConfigForAction } = await import("./llm-config-resolver");
    const { mergeLlmRequestConfig } = await import("./search/utils");
    const { fetchAccessToken } = await import("./llm-access-token");
    const { executeLlmCompletion } = await import("./llm-client");
    const { asrExecutionLogService } = await import("./asr-execution-log-context");

    const actionId = skill.onTranscriptionAutoActionId;
    if (!actionId) {
      return;
    }

    const message = await storage.findChatMessageByTranscriptId(transcript.id);

    try {
      const action = await actionsRepository.getByIdForWorkspace(skill.workspaceId, actionId);
      if (!action || action.target !== "transcript") {
        throw new Error("auto action not found or wrong target");
      }
      const skillAction = await skillActionsRepository.getForSkillAndAction(skill.id, action.id);
      if (!skillAction || !skillAction.enabled) {
        throw new Error("auto action disabled for skill");
      }
      const allowedPlacements = action.placements ?? [];
      const enabledPlacements = skillAction.enabledPlacements ?? [];
      const placement =
        enabledPlacements.find((p) => allowedPlacements.includes(p)) ?? allowedPlacements[0] ?? null;
      if (!placement) {
        throw new Error("no placement available for auto action");
      }

      if (executionId) {
        await asrExecutionLogService.addEvent(executionId, {
          stage: "auto_action_triggered",
          details: { skillId: skill.id, actionId, placement },
        });
      }

      const prompt = action.promptTemplate.replace(/{{\s*text\s*}}/gi, fullText);
      const llmProvider = await resolveLlmConfigForAction(skill, action);
      const requestConfig = mergeLlmRequestConfig(llmProvider);

      const messages: Array<{ role: string; content: string }> = [];
      if (requestConfig.systemPrompt && requestConfig.systemPrompt.trim()) {
        messages.push({ role: "system", content: requestConfig.systemPrompt.trim() });
      }
      messages.push({ role: "user", content: prompt });

      const requestBody: Record<string, unknown> = {
        [requestConfig.modelField]: llmProvider.model,
        [requestConfig.messagesField]: messages,
      };

      if (requestConfig.temperature !== undefined) {
        requestBody.temperature = requestConfig.temperature;
      }
      if (requestConfig.maxTokens !== undefined) {
        requestBody.max_tokens = requestConfig.maxTokens;
      }

      const accessToken = await fetchAccessToken(llmProvider);
      const completion = await executeLlmCompletion(llmProvider, accessToken, requestBody);
      const llmText = completion.answer ?? "";

      const viewContent = llmText && llmText.trim().length > 0 ? llmText.trim() : fullText;
      let previewText = viewContent ? viewContent.slice(0, 200) : "";
      if (!previewText) {
        previewText = this.buildPreview(fullText);
      }

      const view = await storage.createTranscriptView({
        transcriptId: transcript.id,
        actionId: action.id,
        label: action.label ?? "Авто-действие",
        content: viewContent,
      });

      // Для replace_text перезаписываем стенограмму, иначе сохраняем raw текст и делаем превью по авто-действию.
      if (action.outputMode === "replace_text") {
        await storage.updateTranscript(transcript.id, {
          fullText: llmText,
          lastEditedByUserId: chat.userId,
        });
      }

      const defaultViewId = transcript.defaultViewId ?? view.id;
      await storage.updateTranscript(transcript.id, {
        status: "ready",
        previewText,
        defaultViewActionId: action.id,
        defaultViewId,
      });

      if (message) {
        const baseMetadata = (message.metadata as Record<string, unknown>) ?? {};
        const metadata: ChatMessageMetadata = {
          ...(baseMetadata as ChatMessageMetadata),
          transcriptStatus: "ready",
          previewText,
          defaultViewActionId: action.id,
          defaultViewId,
          preferredTranscriptTabId: view.id,
          autoActionFailed: false,
        };
        await storage.updateChatMessage(message.id, {
          metadata,
          content: previewText,
        });
      }

      if (executionId) {
        await asrExecutionLogService.addEvent(executionId, {
          stage: "auto_action_completed",
          details: { skillId: skill.id, actionId, actionLabel: action.label, success: true, viewId: view.id },
        });
        await asrExecutionLogService.addEvent(executionId, {
          stage: "transcript_saved",
          details: { transcriptId: transcript.id, viewId: view.id, defaultViewId },
        });
        await asrExecutionLogService.addEvent(executionId, {
          stage: "transcript_preview_message_created",
          details: { messageId: message?.id, transcriptId: transcript.id, viewId: view.id, defaultViewId },
        });
        await asrExecutionLogService.updateExecution(executionId, {
          status: "success",
          finishedAt: new Date(),
          transcriptId: transcript.id,
          transcriptMessageId: message?.id ?? null,
        });
      }
    } catch (error) {
      console.error("[yandex-stt-async] auto action failed:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (executionId) {
        const { asrExecutionLogService } = await import("./asr-execution-log-context");
        await asrExecutionLogService.addEvent(executionId, {
          stage: "auto_action_completed",
          details: { skillId: skill.id, actionId: skill.onTranscriptionAutoActionId, success: false, errorMessage },
        });
        await asrExecutionLogService.updateExecution(executionId, {
          status: "failed",
          errorMessage,
          finishedAt: new Date(),
          transcriptId: transcript.id,
        });
      }

      // Отмечаем карточку/стенограмму как готовую, но с ошибкой авто-действия
      const fallbackPreview = this.buildPreview(fullText);
      await storage.updateTranscript(transcript.id, {
        status: "ready",
        previewText: fallbackPreview,
      });
      const message = await storage.findChatMessageByTranscriptId(transcript.id);
      if (message) {
        const baseMetadata = (message.metadata as Record<string, unknown>) ?? {};
        const metadata: ChatMessageMetadata = {
          ...(baseMetadata as ChatMessageMetadata),
          transcriptStatus: "auto_action_failed",
          autoActionFailed: true,
          previewText: fallbackPreview,
        };
        await storage.updateChatMessage(message.id, { metadata });

        if (executionId) {
          const { asrExecutionLogService } = await import("./asr-execution-log-context");
          await asrExecutionLogService.addEvent(executionId, {
            stage: "transcript_saved",
            details: { transcriptId: transcript.id },
          });
          await asrExecutionLogService.addEvent(executionId, {
            stage: "transcript_preview_message_created",
            details: { messageId: message.id, transcriptId: transcript.id },
          });
        }
      }
    }
  }

  private async cleanupOperationFile(
    cached: TranscriptionOperation,
    accessKeyId?: string,
    secretAccessKey?: string,
    bucketName?: string
  ): Promise<void> {
    if (!cached.objectKey || !accessKeyId || !secretAccessKey || !bucketName) {
      return;
    }

    try {
      await yandexObjectStorageService.deleteFile(cached.objectKey, {
        accessKeyId,
        secretAccessKey,
        bucketName,
      });
      console.info(`[yandex-stt-async] Cleaned up file: ${cached.objectKey}`);
    } catch (error) {
      console.warn(`[yandex-stt-async] Failed to cleanup file ${cached.objectKey}:`, error);
    }
  }

  private async getSecretValues(providerId: string): Promise<SecretValues> {
    const { storage } = await import("./storage");
    const secrets = await storage.getSpeechProviderSecrets(providerId);

    const result: SecretValues = {};
    for (const secret of secrets) {
      if (secret.secretKey === "serviceAccountKey" && secret.secretValue) {
        result.serviceAccountKey = secret.secretValue;
      }
      if (secret.secretKey === "folderId" && secret.secretValue) {
        result.folderId = secret.secretValue;
      }
      if (secret.secretKey === "apiKey" && secret.secretValue) {
        result.apiKey = secret.secretValue;
      }
      if (secret.secretKey === "s3AccessKeyId" && secret.secretValue) {
        result.s3AccessKeyId = secret.secretValue;
      }
      if (secret.secretKey === "s3SecretAccessKey" && secret.secretValue) {
        result.s3SecretAccessKey = secret.secretValue;
      }
      if (secret.secretKey === "s3BucketName" && secret.secretValue) {
        result.s3BucketName = secret.secretValue;
      }
    }
    return result;
  }

  private buildPreview(text: string, maxWords = 60): string {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      return text.trim();
    }
    return words.slice(0, maxWords).join(" ").trim();
  }

  private async updateTranscriptAndMessage(
    sourceFileId: string | undefined,
    status: TranscriptStatus,
    fullText?: string,
    errorMessage?: string,
  ): Promise<void> {
    if (!sourceFileId) return;
    const { storage } = await import("./storage");

    const transcript = await storage.getTranscriptBySourceFileId(sourceFileId);
    if (!transcript) {
      return;
    }

    const updates: Partial<{
      status: TranscriptStatus;
      fullText: string | null;
      previewText: string | null;
    }> = { status };

    if (fullText !== undefined) {
      updates.fullText = fullText;
      if (status === "ready") {
        updates.previewText = this.buildPreview(fullText);
      }
    }

    if (status === "failed" && !updates.previewText) {
      updates.previewText = errorMessage ?? "Ошибка распознавания аудио";
    }

    await storage.updateTranscript(transcript.id, updates);

    const message = await storage.findChatMessageByTranscriptId(transcript.id);
    if (!message) {
      return;
    }

    const newMetadata: ChatMessageMetadata = {
      ...(message.metadata as ChatMessageMetadata | undefined ?? {}),
      type: "transcript",
      transcriptId: transcript.id,
      transcriptStatus: status,
    };

    if (updates.previewText) {
      (newMetadata as Record<string, unknown>).previewText = updates.previewText;
    }

    let content = message.content;
    if (status === "ready") {
      content = "Готова стенограмма. Нажмите, чтобы открыть.";
    } else if (status === "failed") {
      content = "Не удалось распознать аудио. Попробуйте позже или загрузите другой файл.";
    }

    await storage.updateChatMessage(message.id, {
      content,
      metadata: newMetadata,
    });
  }
}

export const yandexSttAsyncService = new YandexSttAsyncService();

import { speechProviderService, SpeechProviderDisabledError } from "./speech-provider-service";
import { yandexIamTokenService } from "./yandex-iam-token-service";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import fetch from "node-fetch";

// Runtime imports for agents
const createHttpProxyAgent = (url: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HttpProxyAgentModule = require("http-proxy-agent");
    return new HttpProxyAgentModule(url);
  } catch {
    return undefined;
  }
};

const createHttpsProxyAgent = (url: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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

// In-memory operation cache (in production, use database)
interface TranscriptionOperation {
  id: string;
  userId: string;
  operationId: string;
  createdAt: Date;
  status: "pending" | "completed" | "failed";
  result?: { text: string; lang: string };
  error?: string;
}

const operationsCache = new Map<string, TranscriptionOperation>();

// Cleanup old operations after 24 hours
setInterval(() => {
  const now = Date.now();
  for (const [key, op] of operationsCache.entries()) {
    if (now - op.createdAt.getTime() > 24 * 60 * 60 * 1000) {
      operationsCache.delete(key);
    }
  }
}, 60 * 60 * 1000); // Every hour

function needsConversion(mimeType: string): boolean {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  return baseMimeType === "audio/webm";
}

export async function convertWebmToOgg(audioBuffer: Buffer): Promise<Buffer> {
  const tempId = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `input_${tempId}.webm`);
  const outputPath = join(tmpdir(), `output_${tempId}.ogg`);

  try {
    await writeFile(inputPath, audioBuffer);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
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
}

export interface AsyncTranscribeResponse {
  operationId: string;
  message: string;
}

export interface TranscribeOperationStatus {
  operationId: string;
  status: "pending" | "completed" | "failed";
  result?: { text: string; lang: string };
  error?: string;
}

class YandexSttAsyncService {
  async startAsyncTranscription(options: AsyncTranscribeOptions): Promise<AsyncTranscribeResponse> {
    let { audioBuffer, mimeType, userId } = options;

    const providerDetail = await speechProviderService.getActiveSttProviderOrThrow();
    const { provider, secrets } = providerDetail;
    const config = providerDetail.config as Record<string, string | boolean | undefined>;

    if (!secrets.folderId?.isSet) {
      throw new YandexSttAsyncConfigError("Folder ID Yandex Cloud не настроен. Установите его в настройках провайдера.");
    }
    if (!secrets.serviceAccountKey?.isSet) {
      throw new YandexSttAsyncConfigError("Service Account Key не настроен. Требуется для асинхронного API. Установите его в настройках провайдера.");
    }

    const secretValues = await this.getSecretValues(provider.id);
    const serviceAccountKey = secretValues.serviceAccountKey;
    const folderId = secretValues.folderId;

    if (!serviceAccountKey || !folderId) {
      throw new YandexSttAsyncConfigError("Service Account Key или Folder ID отсутствуют в хранилище секретов.");
    }

    // Get IAM token (cached with auto-refresh)
    let iamToken: string;
    try {
      iamToken = await yandexIamTokenService.getIamToken(serviceAccountKey);
    } catch (error) {
      throw new YandexSttAsyncConfigError(
        `Не удалось получить IAM токен: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (needsConversion(mimeType)) {
      try {
        console.info(`[yandex-stt-async] Converting WebM to OGG...`);
        audioBuffer = await convertWebmToOgg(audioBuffer);
        mimeType = "audio/ogg";
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

    console.info(`[yandex-stt-async] Starting async transcription: ${audioBuffer.length} bytes, lang=${lang}, user=${userId}`);

    try {
      // Setup proxy agents for network compatibility
      const httpProxyAgent = process.env.HTTP_PROXY ? createHttpProxyAgent(process.env.HTTP_PROXY) : undefined;
      const httpsProxyAgent = process.env.HTTPS_PROXY ? createHttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;

      // In production, would upload to Object Storage first
      // For now, using direct binary body (max 1GB)
      const response = await fetch(YANDEX_ASYNC_STT_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${iamToken}`,
          "Content-Type": "application/octet-stream",
          "X-Folder-Id": folderId,
        },
        body: audioBuffer,
        agent: YANDEX_ASYNC_STT_ENDPOINT.startsWith("https") ? httpsProxyAgent : httpProxyAgent,
      } as Parameters<typeof fetch>[1]);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[yandex-stt-async] API error: ${response.status} - ${errorText}`);

        if (response.status === 401 || response.status === 403) {
          throw new YandexSttAsyncError(
            "Ошибка аутентификации Yandex SpeechKit. Проверьте IAM токен.",
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

      if (!operationResponse.id) {
        throw new YandexSttAsyncError("Не получен ID операции от Yandex", 500, "NO_OPERATION_ID");
      }

      const operationId = operationResponse.id;
      const cacheId = `${userId}_${operationId}`;

      // Store in cache for polling
      operationsCache.set(cacheId, {
        id: cacheId,
        userId,
        operationId,
        createdAt: new Date(),
        status: "pending",
      });

      console.info(`[yandex-stt-async] Operation started: ${operationId}`);

      return {
        operationId,
        message: "Транскрибация началась. Пожалуйста, дождитесь завершения.",
      };
    } catch (error) {
      if (error instanceof YandexSttAsyncError || error instanceof SpeechProviderDisabledError) {
        throw error;
      }
      console.error("[yandex-stt-async] Network error:", error);
      throw new YandexSttAsyncError(
        `Ошибка сети при обращении к Yandex SpeechKit: ${error instanceof Error ? error.message : String(error)}`,
        503,
        "NETWORK_ERROR"
      );
    }
  }

  async getOperationStatus(userId: string, operationId: string): Promise<TranscribeOperationStatus> {
    const cacheId = `${userId}_${operationId}`;
    const cached = operationsCache.get(cacheId);

    if (!cached) {
      throw new YandexSttAsyncError("Операция не найдена", 404, "NOT_FOUND");
    }

    // If already completed or failed, return cached result
    if (cached.status !== "pending") {
      return {
        operationId,
        status: cached.status,
        result: cached.result,
        error: cached.error,
      };
    }

    // Poll Yandex for current status
    try {
      const providerDetail = await speechProviderService.getActiveSttProviderOrThrow();
      const secretValues = await this.getSecretValues(providerDetail.provider.id);
      const serviceAccountKey = secretValues.serviceAccountKey;

      if (!serviceAccountKey) {
        throw new YandexSttAsyncError("Service Account Key отсутствует", 500, "NO_KEY");
      }

      const iamToken = await yandexIamTokenService.getIamToken(serviceAccountKey);

      // Setup proxy agents for network compatibility
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
          return {
            operationId,
            status: "failed",
            error: "Операция не найдена на сервере Yandex",
          };
        }

        throw new YandexSttAsyncError(`Ошибка при проверке статуса: ${response.status}`, response.status, "CHECK_ERROR");
      }

      const operationData = await response.json() as {
        done?: boolean;
        error?: { message: string; code: number };
        response?: { chunks: Array<{ alternatives: Array<{ transcript: string }> }> };
      };

      if (operationData.error) {
        cached.status = "failed";
        cached.error = operationData.error.message;
        return {
          operationId,
          status: "failed",
          error: operationData.error.message,
        };
      }

      if (operationData.done && operationData.response) {
        // Extract text from chunks
        const chunks = operationData.response.chunks || [];
        const text = chunks
          .map((chunk) => chunk.alternatives?.[0]?.transcript || "")
          .join(" ")
          .trim();

        cached.status = "completed";
        cached.result = { text, lang: "ru-RU" };

        console.info(`[yandex-stt-async] Operation completed: ${operationId}`);

        return {
          operationId,
          status: "completed",
          result: { text, lang: "ru-RU" },
        };
      }

      // Still pending
      return {
        operationId,
        status: "pending",
      };
    } catch (error) {
      if (error instanceof YandexSttAsyncError) {
        throw error;
      }
      console.error("[yandex-stt-async] Status check error:", error);
      throw new YandexSttAsyncError(
        `Ошибка при проверке статуса операции: ${error instanceof Error ? error.message : String(error)}`,
        503,
        "CHECK_ERROR"
      );
    }
  }

  private async getSecretValues(providerId: string): Promise<{ serviceAccountKey?: string; folderId?: string }> {
    const { storage } = await import("./storage");
    const secrets = await storage.getSpeechProviderSecrets(providerId);

    const result: { serviceAccountKey?: string; folderId?: string } = {};
    for (const secret of secrets) {
      if (secret.secretKey === "serviceAccountKey" && secret.secretValue) {
        result.serviceAccountKey = secret.secretValue;
      }
      if (secret.secretKey === "folderId" && secret.secretValue) {
        result.folderId = secret.secretValue;
      }
    }
    return result;
  }
}

export const yandexSttAsyncService = new YandexSttAsyncService();

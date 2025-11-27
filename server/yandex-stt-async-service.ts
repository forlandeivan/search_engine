import { speechProviderService, SpeechProviderDisabledError } from "./speech-provider-service";
import { yandexIamTokenService } from "./yandex-iam-token-service";
import { yandexObjectStorageService, ObjectStorageError, ObjectStorageCredentials } from "./yandex-object-storage-service";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import fetch from "node-fetch";

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
}

const operationsCache = new Map<string, TranscriptionOperation>();

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
  originalFileName?: string;
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
    let { audioBuffer, mimeType, userId, originalFileName } = options;

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

    const s3Credentials: ObjectStorageCredentials = {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      bucketName: s3BucketName,
    };

    let uploadResult;
    try {
      uploadResult = await yandexObjectStorageService.uploadAudioFile(
        audioBuffer,
        mimeType,
        s3Credentials,
        originalFileName
      );
      console.info(`[yandex-stt-async] File uploaded to Object Storage: ${uploadResult.uri}`);
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

      console.info(`[yandex-stt-async] Sending async STT request with URI: ${uploadResult.uri}`);

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
    const cacheId = `${userId}_${operationId}`;
    const cached = operationsCache.get(cacheId);

    if (!cached) {
      throw new YandexSttAsyncError("Операция не найдена", 404, "NOT_FOUND");
    }

    if (cached.status !== "pending") {
      return {
        operationId,
        status: cached.status,
        result: cached.result,
        error: cached.error,
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
          await this.cleanupOperationFile(cached, s3AccessKeyId, s3SecretAccessKey, s3BucketName);
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
        response?: { chunks: Array<{ alternatives: Array<{ text: string }> }> };
      };

      if (operationData.error) {
        cached.status = "failed";
        cached.error = operationData.error.message;
        await this.cleanupOperationFile(cached, s3AccessKeyId, s3SecretAccessKey, s3BucketName);
        return {
          operationId,
          status: "failed",
          error: operationData.error.message,
        };
      }

      if (operationData.done && operationData.response) {
        const chunks = operationData.response.chunks || [];
        const text = chunks
          .map((chunk) => chunk.alternatives?.[0]?.text || "")
          .join(" ")
          .trim();

        cached.status = "completed";
        cached.result = { text, lang: "ru-RU" };

        await this.cleanupOperationFile(cached, s3AccessKeyId, s3SecretAccessKey, s3BucketName);

        console.info(`[yandex-stt-async] Operation completed: ${operationId}, text length: ${text.length}`);

        return {
          operationId,
          status: "completed",
          result: { text, lang: "ru-RU" },
        };
      }

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
}

export const yandexSttAsyncService = new YandexSttAsyncService();

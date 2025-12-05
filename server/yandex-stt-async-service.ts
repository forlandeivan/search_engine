import { speechProviderService, SpeechProviderDisabledError } from "./speech-provider-service";
import { yandexIamTokenService } from "./yandex-iam-token-service";
import { yandexObjectStorageService, ObjectStorageError, ObjectStorageCredentials } from "./yandex-object-storage-service";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { tmpdir } from "os";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import fetch from "node-fetch";
import type { ChatMessageMetadata, TranscriptStatus } from "@shared/schema";

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
  // Конвертируем всё, что не OGG/OPUS, в OGG для совместимости с async STT.
  return baseMimeType !== "audio/ogg" && baseMimeType !== "audio/opus";
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
  originalFileName?: string;
  chatId?: string;
  transcriptId?: string;
  executionId?: string;
}

export interface AsyncTranscribeResponse {
  operationId: string;
  message: string;
  uploadResult?: UploadResult;
}

export interface TranscribeOperationStatus {
  operationId: string;
  status: "pending" | "completed" | "failed";
  result?: { text: string; lang: string };
  error?: string;
  chatId?: string;
  transcriptId?: string;
  executionId?: string;
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
    let { audioBuffer, mimeType, userId, originalFileName, chatId, transcriptId, executionId } = options;

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
        console.info(`[yandex-stt-async] Converting ${mimeType} to OGG...`);
        audioBuffer = await convertAudioToOgg(audioBuffer, mimeType);
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
        chatId,
        transcriptId,
        executionId,
      });

      console.info(`[yandex-stt-async] Operation started: ${operationId}`);

      return {
        operationId,
        message: "Транскрибация началась. Пожалуйста, дождитесь завершения.",
        uploadResult,
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
        response?: { chunks: Array<{ alternatives: Array<{ text: string }> }> };
      };

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
        const chunks = operationData.response.chunks || [];
        const text = chunks
          .map((chunk) => {
            const alternatives = chunk.alternatives || [];
            if (alternatives.length === 0) return "";
            // Возьми альтернативу с наивысшей confidence или первую если confidence не задана
            const best = alternatives.reduce((best, alt) => {
              const altConf = (alt as any).confidence ?? 0;
              const bestConf = (best as any).confidence ?? 0;
              return altConf > bestConf ? alt : best;
            });
            return best.text || "";
          })
          .filter(text => text.length > 0)
          .join(" ")
          .trim();

        cached.status = "completed";
        cached.result = { text, lang: "ru-RU" };
        if (!cached.chatId && jobId) {
          cached.chatId = jobId;
        }
        if (!cached.executionId && jobId) {
          cached.executionId = jobId;
        }

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

        console.info(`[yandex-stt-async] Operation completed: ${operationId}, chunks: ${chunks.length}, text length: ${text.length}`);

        // Логируем в журнал ASR
        if (cached.executionId) {
          const { asrExecutionLogService } = await import("./asr-execution-log-context");
          const previewText = text.slice(0, 200);
          await asrExecutionLogService.addEvent(cached.executionId, {
            stage: "asr_result_final",
            details: { provider: "yandex_speechkit", operationId, previewText },
          });
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
          chatId: cached.chatId,
          transcriptId: transcriptForContext?.id ?? cached.transcriptId,
          executionId: cached.executionId,
        };
      }

      return {
        operationId,
        status: "pending",
        chatId: cached.chatId,
        transcriptId: cached.transcriptId,
        executionId: cached.executionId,
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

      let previewText = llmText && llmText.trim().length > 0 ? llmText.trim().slice(0, 200) : "";
      if (!previewText) {
        previewText = this.buildPreview(fullText);
      }

      // Для replace_text перезаписываем стенограмму, иначе сохраняем raw текст и делаем превью по авто-действию.
      if (action.outputMode === "replace_text") {
        await storage.updateTranscript(transcript.id, {
          fullText: llmText,
          lastEditedByUserId: chat.userId,
        });
      }

      await storage.updateTranscript(transcript.id, {
        status: "ready",
        previewText,
        defaultViewActionId: action.id,
      });

      if (message) {
        const baseMetadata = (message.metadata as Record<string, unknown>) ?? {};
        const metadata = {
          ...baseMetadata,
          transcriptStatus: "ready",
          previewText,
          defaultViewActionId: action.id,
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
          details: { skillId: skill.id, actionId, success: true },
        });
        await asrExecutionLogService.addEvent(executionId, {
          stage: "transcript_saved",
          details: { transcriptId: transcript.id },
        });
        await asrExecutionLogService.addEvent(executionId, {
          stage: "transcript_preview_message_created",
          details: { messageId: message?.id, transcriptId: transcript.id },
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
        const metadata = {
          ...baseMetadata,
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

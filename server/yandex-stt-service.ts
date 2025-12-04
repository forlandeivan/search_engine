import { speechProviderService, SpeechProviderDisabledError } from "./speech-provider-service";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { tmpdir } from "os";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

export class YandexSttError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "YandexSttError";
    this.status = status;
    this.code = code;
  }
}

export class YandexSttConfigError extends YandexSttError {
  constructor(message: string) {
    super(message, 400, "CONFIG_ERROR");
    this.name = "YandexSttConfigError";
  }
}

const YANDEX_STT_ENDPOINT = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";

const SUPPORTED_AUDIO_FORMATS = [
  "audio/ogg",
  "audio/opus",
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/x-pcm",
  "audio/l16",
] as const;

export type SupportedAudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

export function isSupportedAudioFormat(mimeType: string): boolean {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  return SUPPORTED_AUDIO_FORMATS.includes(baseMimeType as SupportedAudioFormat);
}

export function normalizeAudioMimeType(mimeType: string): string {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  return baseMimeType;
}

export function getYandexFormat(mimeType: string): "oggopus" | "lpcm" {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  
  if (baseMimeType === "audio/wav" || baseMimeType === "audio/x-wav" || 
      baseMimeType === "audio/x-pcm" || baseMimeType === "audio/l16") {
    return "lpcm";
  }
  
  return "oggopus";
}

export function needsConversion(mimeType: string): boolean {
  const baseMimeType = mimeType.split(";")[0].trim().toLowerCase();
  return baseMimeType === "audio/webm";
}

export async function convertWebmToOgg(audioBuffer: Buffer): Promise<Buffer> {
  const tempId = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `input_${tempId}.webm`);
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
    console.info(`[yandex-stt] Converted WebM to OGG: ${audioBuffer.length} -> ${outputBuffer.length} bytes`);
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

export interface TranscribeOptions {
  audioBuffer: Buffer;
  mimeType: string;
  lang?: string;
}

export interface TranscribeResult {
  text: string;
  lang: string;
}

class YandexSttService {
  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    let { audioBuffer, mimeType } = options;

    const providerDetail = await speechProviderService.getActiveSttProviderOrThrow();
    const { provider, secrets } = providerDetail;
    const config = providerDetail.config as Record<string, string | boolean | undefined>;

    if (!secrets.apiKey?.isSet) {
      throw new YandexSttConfigError("API ключ Yandex SpeechKit не настроен. Установите его в настройках провайдера.");
    }
    if (!secrets.folderId?.isSet) {
      throw new YandexSttConfigError("Folder ID Yandex Cloud не настроен. Установите его в настройках провайдера.");
    }

    const secretValues = await this.getSecretValues(provider.id);
    const apiKey = secretValues.apiKey;
    const folderId = secretValues.folderId;

    if (!apiKey || !folderId) {
      throw new YandexSttConfigError("API ключ или Folder ID отсутствуют в хранилище секретов.");
    }

    if (needsConversion(mimeType)) {
      try {
        console.info(`[yandex-stt] Converting WebM to OGG...`);
        audioBuffer = await convertWebmToOgg(audioBuffer);
        mimeType = "audio/ogg";
      } catch (conversionError) {
        console.error("[yandex-stt] Conversion failed:", conversionError);
        throw new YandexSttError(
          "Не удалось конвертировать аудио формат. Попробуйте использовать другой браузер.",
          400,
          "CONVERSION_ERROR"
        );
      }
    }

    const lang = options.lang ?? (config.languageCode as string) ?? "ru-RU";
    const model = (config.model as string) ?? "general";
    const yandexFormat = getYandexFormat(mimeType);

    const queryParams = new URLSearchParams({
      folderId,
      lang,
      topic: model,
      format: yandexFormat,
    });

    if (config.enablePunctuation !== false) {
      queryParams.append("punctuation", "true");
    }

    const url = `${YANDEX_STT_ENDPOINT}?${queryParams.toString()}`;

    console.info(`[yandex-stt] Transcribing audio: ${audioBuffer.length} bytes, format=${yandexFormat}, lang=${lang}`);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Api-Key ${apiKey}`,
          "Content-Type": "application/octet-stream",
        },
        body: audioBuffer,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[yandex-stt] API error: ${response.status} - ${errorText}`);
        
        if (response.status === 401 || response.status === 403) {
          throw new YandexSttError(
            "Ошибка аутентификации Yandex SpeechKit. Проверьте API ключ и Folder ID.",
            response.status,
            "AUTH_ERROR"
          );
        }
        if (response.status === 400) {
          throw new YandexSttError(
            `Некорректный запрос к Yandex SpeechKit: ${errorText}`,
            response.status,
            "BAD_REQUEST"
          );
        }
        throw new YandexSttError(
          `Ошибка Yandex SpeechKit: ${response.status} - ${errorText}`,
          response.status,
          "API_ERROR"
        );
      }

      const result = await response.json() as { result?: string };
      
      if (!result.result) {
        console.info("[yandex-stt] Empty transcription result - no speech detected");
        return {
          text: "",
          lang,
        };
      }

      console.info(`[yandex-stt] Transcription success: "${result.result.substring(0, 50)}..."`);

      return {
        text: result.result,
        lang,
      };
    } catch (error) {
      if (error instanceof YandexSttError || error instanceof SpeechProviderDisabledError) {
        throw error;
      }
      console.error("[yandex-stt] Network error:", error);
      throw new YandexSttError(
        `Ошибка сети при обращении к Yandex SpeechKit: ${error instanceof Error ? error.message : String(error)}`,
        503,
        "NETWORK_ERROR"
      );
    }
  }

  private async getSecretValues(providerId: string): Promise<{ apiKey?: string; folderId?: string }> {
    const { storage } = await import("./storage");
    const secrets = await storage.getSpeechProviderSecrets(providerId);
    
    console.info(`[yandex-stt] Retrieved ${secrets.length} secrets from DB`);
    
    const result: { apiKey?: string; folderId?: string } = {};
    for (const secret of secrets) {
      console.info(`[yandex-stt] Processing secret: ${secret.secretKey}`);
      if (secret.secretKey === "apiKey" && secret.secretValue) {
        result.apiKey = secret.secretValue;
        console.info(`[yandex-stt] Found API key from DB: ${secret.secretValue.substring(0, 10)}...`);
      }
      if (secret.secretKey === "folderId" && secret.secretValue) {
        result.folderId = secret.secretValue;
        console.info(`[yandex-stt] Found folder ID from DB: ${secret.secretValue}`);
      }
    }
    
    // Fallback to environment variables if DB values are missing
    if (!result.apiKey) {
      result.apiKey = process.env.YANDEX_STT_API_KEY;
      if (result.apiKey) console.info(`[yandex-stt] Using API key from env`);
    }
    if (!result.folderId) {
      result.folderId = process.env.YANDEX_STT_FOLDER_ID;
      if (result.folderId) console.info(`[yandex-stt] Using folder ID from env`);
    }
    return result;
  }

  async checkHealth(): Promise<{ available: boolean; error?: string }> {
    try {
      const providerDetail = await speechProviderService.getActiveSttProviderOrThrow();
      const { secrets } = providerDetail;
      
      if (!secrets.apiKey?.isSet || !secrets.folderId?.isSet) {
        return {
          available: false,
          error: "API ключ или Folder ID не настроены",
        };
      }

      return { available: true };
    } catch (error) {
      if (error instanceof SpeechProviderDisabledError) {
        return {
          available: false,
          error: "STT провайдер отключен",
        };
      }
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const yandexSttService = new YandexSttService();

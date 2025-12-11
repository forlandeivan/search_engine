import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

export interface ObjectStorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region?: string;
}

export interface UploadResult {
  uri: string;
  objectKey: string;
  bucketName: string;
}

export class ObjectStorageError extends Error {
  constructor(
    message: string,
    public code: string = "STORAGE_ERROR"
  ) {
    super(message);
    this.name = "ObjectStorageError";
  }
}

class YandexObjectStorageService {
  private static instance: YandexObjectStorageService;
  private s3Client: S3Client | null = null;
  private credentials: ObjectStorageCredentials | null = null;

  private constructor() {}

  static getInstance(): YandexObjectStorageService {
    if (!YandexObjectStorageService.instance) {
      YandexObjectStorageService.instance = new YandexObjectStorageService();
    }
    return YandexObjectStorageService.instance;
  }

  private getS3Client(credentials: ObjectStorageCredentials): S3Client {
    if (
      this.s3Client &&
      this.credentials?.accessKeyId === credentials.accessKeyId &&
      this.credentials?.secretAccessKey === credentials.secretAccessKey
    ) {
      return this.s3Client;
    }

    this.s3Client = new S3Client({
      endpoint: "https://storage.yandexcloud.net",
      region: credentials.region || "ru-central1",
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      forcePathStyle: true,
    });

    this.credentials = credentials;
    return this.s3Client;
  }

  async uploadFile(
    buffer: Buffer,
    mimeType: string,
    credentials: ObjectStorageCredentials,
    objectKey?: string,
  ): Promise<UploadResult> {
    if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.bucketName) {
      throw new ObjectStorageError(
        "Не настроены учетные данные Object Storage. Укажите accessKeyId, secretAccessKey и bucketName в настройках провайдера.",
        "MISSING_CREDENTIALS"
      );
    }

    const s3Client = this.getS3Client(credentials);
    const key = objectKey ?? `uploads/${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

    try {
      const command = new PutObjectCommand({
        Bucket: credentials.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await s3Client.send(command);

      const uri = `https://storage.yandexcloud.net/${credentials.bucketName}/${key}`;
      return { uri, objectKey: key, bucketName: credentials.bucketName };
    } catch (error) {
      console.error("[object-storage] Upload failed:", error);
      throw new ObjectStorageError(
        `Ошибка загрузки файла в Object Storage: ${error instanceof Error ? error.message : String(error)}`,
        "UPLOAD_FAILED"
      );
    }
  }

  async uploadAudioFile(
    audioBuffer: Buffer,
    mimeType: string,
    credentials: ObjectStorageCredentials,
    originalFileName?: string
  ): Promise<UploadResult> {
    if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.bucketName) {
      throw new ObjectStorageError(
        "Не настроены учетные данные Object Storage. Укажите accessKeyId, secretAccessKey и bucketName в настройках провайдера.",
        "MISSING_CREDENTIALS"
      );
    }

    const s3Client = this.getS3Client(credentials);

    const extension = this.getExtensionFromMimeType(mimeType);
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString("hex");
    const safeFileName = originalFileName 
      ? originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 50)
      : "audio";
    
    const objectKey = `stt-audio/${timestamp}_${randomId}_${safeFileName}${extension}`;

    console.info(`[object-storage] Uploading file: ${objectKey}, size: ${audioBuffer.length} bytes, mimeType: ${mimeType}`);

    try {
      const command = new PutObjectCommand({
        Bucket: credentials.bucketName,
        Key: objectKey,
        Body: audioBuffer,
        ContentType: mimeType,
      });

      await s3Client.send(command);

      const uri = `https://storage.yandexcloud.net/${credentials.bucketName}/${objectKey}`;
      
      console.info(`[object-storage] Upload successful: ${uri}`);

      return {
        uri,
        objectKey,
        bucketName: credentials.bucketName,
      };
    } catch (error) {
      console.error("[object-storage] Upload failed:", error);
      
      if (error instanceof Error) {
        if (error.name === "NoSuchBucket") {
          throw new ObjectStorageError(
            `Бакет "${credentials.bucketName}" не найден. Создайте бакет в Yandex Cloud Console.`,
            "BUCKET_NOT_FOUND"
          );
        }
        if (error.name === "AccessDenied" || error.message.includes("Access Denied")) {
          throw new ObjectStorageError(
            "Отказано в доступе к Object Storage. Проверьте права доступа сервисного аккаунта.",
            "ACCESS_DENIED"
          );
        }
        if (error.name === "InvalidAccessKeyId") {
          throw new ObjectStorageError(
            "Неверный Access Key ID для Object Storage.",
            "INVALID_CREDENTIALS"
          );
        }
        if (error.name === "SignatureDoesNotMatch") {
          throw new ObjectStorageError(
            "Неверный Secret Access Key для Object Storage.",
            "INVALID_CREDENTIALS"
          );
        }
      }
      
      throw new ObjectStorageError(
        `Ошибка загрузки файла в Object Storage: ${error instanceof Error ? error.message : String(error)}`,
        "UPLOAD_FAILED"
      );
    }
  }

  async deleteFile(
    objectKey: string,
    credentials: ObjectStorageCredentials
  ): Promise<void> {
    const s3Client = this.getS3Client(credentials);

    try {
      const command = new DeleteObjectCommand({
        Bucket: credentials.bucketName,
        Key: objectKey,
      });

      await s3Client.send(command);
      console.info(`[object-storage] Deleted file: ${objectKey}`);
    } catch (error) {
      console.warn(`[object-storage] Failed to delete file ${objectKey}:`, error);
    }
  }

  async checkFileExists(
    objectKey: string,
    credentials: ObjectStorageCredentials
  ): Promise<boolean> {
    const s3Client = this.getS3Client(credentials);

    try {
      const command = new HeadObjectCommand({
        Bucket: credentials.bucketName,
        Key: objectKey,
      });

      await s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async validateCredentials(credentials: ObjectStorageCredentials): Promise<{ valid: boolean; error?: string }> {
    if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.bucketName) {
      return {
        valid: false,
        error: "Не все обязательные поля заполнены (accessKeyId, secretAccessKey, bucketName)",
      };
    }

    try {
      const s3Client = this.getS3Client(credentials);
      
      const testKey = `_connection_test_${Date.now()}.tmp`;
      const putCommand = new PutObjectCommand({
        Bucket: credentials.bucketName,
        Key: testKey,
        Body: Buffer.from("test"),
        ContentType: "text/plain",
      });

      await s3Client.send(putCommand);

      const deleteCommand = new DeleteObjectCommand({
        Bucket: credentials.bucketName,
        Key: testKey,
      });
      await s3Client.send(deleteCommand);

      return { valid: true };
    } catch (error) {
      console.error("[object-storage] Validation failed:", error);
      
      if (error instanceof Error) {
        if (error.name === "NoSuchBucket") {
          return { valid: false, error: `Бакет "${credentials.bucketName}" не найден` };
        }
        if (error.name === "AccessDenied" || error.message.includes("Access Denied")) {
          return { valid: false, error: "Отказано в доступе. Проверьте права сервисного аккаунта" };
        }
        if (error.name === "InvalidAccessKeyId") {
          return { valid: false, error: "Неверный Access Key ID" };
        }
        if (error.name === "SignatureDoesNotMatch") {
          return { valid: false, error: "Неверный Secret Access Key" };
        }
        return { valid: false, error: error.message };
      }
      
      return { valid: false, error: "Неизвестная ошибка подключения" };
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      "audio/ogg": ".ogg",
      "audio/opus": ".ogg",
      "audio/mpeg": ".mp3",
      "audio/mp3": ".mp3",
      "audio/wav": ".wav",
      "audio/wave": ".wav",
      "audio/x-wav": ".wav",
      "audio/webm": ".webm",
      "audio/mp4": ".m4a",
      "audio/aac": ".aac",
      "audio/flac": ".flac",
    };

    return mimeToExt[mimeType] || ".bin";
  }
}

export const yandexObjectStorageService = YandexObjectStorageService.getInstance();

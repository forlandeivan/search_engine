import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  currentPart: number;
  totalParts: number;
}

interface InitUploadResponse {
  uploadId: string;
  fileKey: string;
  partSize: number;
  totalParts: number;
  presignedUrls: Array<{
    partNumber: number;
    url: string;
    expiresAt: string;
  }>;
}

interface CompleteUploadResponse {
  fileKey: string;
  fileSize: number;
}

export function useJsonImportUpload(workspaceId: string) {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<{ fileKey: string; fileSize: number }> => {
      setIsUploading(true);
      setError(null);
      setUploadProgress(null);

      const controller = new AbortController();
      setAbortController(controller);

      try {
        // Step 1: Initialize multipart upload
        const initResponse = await apiRequest(
          "POST",
          "/api/knowledge/json-import/upload/init",
          {
            fileName: file.name,
            fileSize: file.size,
            contentType: file.type || "application/json",
          },
          undefined,
          { workspaceId },
        );

        if (!initResponse.ok) {
          const errorData = await initResponse.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || "Не удалось инициализировать загрузку");
        }

        const initData = (await initResponse.json()) as InitUploadResponse;

        // Step 2: Upload parts
        const parts: Array<{ partNumber: number; etag: string }> = [];
        const partSize = initData.partSize;
        const totalParts = initData.totalParts;

        for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
          if (controller.signal.aborted) {
            throw new Error("Загрузка отменена");
          }

          const start = (partNumber - 1) * partSize;
          const end = Math.min(start + partSize, file.size);
          const part = file.slice(start, end);

          const presignedUrl = initData.presignedUrls.find((p) => p.partNumber === partNumber);
          if (!presignedUrl) {
            throw new Error(`Не найден presigned URL для части ${partNumber}`);
          }

          // Upload part
          const uploadResponse = await fetch(presignedUrl.url, {
            method: "PUT",
            body: part,
            signal: controller.signal,
          });

          if (!uploadResponse.ok) {
            throw new Error(`Ошибка загрузки части ${partNumber}`);
          }

          const etag = uploadResponse.headers.get("ETag");
          if (!etag) {
            throw new Error(`Не получен ETag для части ${partNumber}`);
          }

          // Remove quotes from ETag if present
          const cleanEtag = etag.replace(/^"|"$/g, "");
          parts.push({ partNumber, etag: cleanEtag });

          // Update progress
          const uploadedBytes = end;
          setUploadProgress({
            uploadedBytes,
            totalBytes: file.size,
            percent: Math.round((uploadedBytes / file.size) * 100),
            currentPart: partNumber,
            totalParts,
          });
        }

        // Step 3: Complete multipart upload
        const completeResponse = await apiRequest(
          "POST",
          "/api/knowledge/json-import/upload/complete",
          {
            uploadId: initData.uploadId,
            fileKey: initData.fileKey,
            parts,
          },
          undefined,
          { workspaceId },
        );

        if (!completeResponse.ok) {
          const errorData = await completeResponse.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(errorData.error || "Не удалось завершить загрузку");
        }

        const completeData = (await completeResponse.json()) as CompleteUploadResponse;

        setUploadProgress({
          uploadedBytes: file.size,
          totalBytes: file.size,
          percent: 100,
          currentPart: totalParts,
          totalParts,
        });

        return completeData;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка загрузки";
        setError(message);
        throw err;
      } finally {
        setIsUploading(false);
        setAbortController(null);
      }
    },
    [workspaceId],
  );

  const abort = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsUploading(false);
      setUploadProgress(null);
    }
  }, [abortController]);

  return {
    uploadFile,
    uploadProgress,
    isUploading,
    error,
    abort,
  };
}

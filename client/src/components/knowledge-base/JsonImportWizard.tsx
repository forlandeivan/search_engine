import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { Loader2, FileJson, X } from "lucide-react";
import type { CreateJsonImportRequest } from "@shared/json-import";

interface JsonImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseId: string;
  workspaceId: string;
  onImportStarted?: (jobId: string) => void;
}

export function JsonImportWizard({
  open,
  onOpenChange,
  baseId,
  workspaceId,
  onImportStarted,
}: JsonImportWizardProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(workspaceId);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setError(null);
  };

  const handleFileUpload = async () => {
    if (!file) {
      setError("Выберите файл для импорта");
      return;
    }

    // Проверка расширения
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".json") && !fileName.endsWith(".jsonl")) {
      setError("Поддерживаются только файлы .json и .jsonl");
      return;
    }

    // Проверка размера (2GB)
    const maxSize = 2 * 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("Размер файла превышает максимально допустимый (2GB)");
      return;
    }

    setError(null);

    try {
      const result = await uploadFile(file);
      setUploadedFileKey(result.fileKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить файл";
      setError(message);
      toast({
        variant: "destructive",
        title: "Ошибка загрузки",
        description: message,
      });
    }
  };

  const handleStartImport = async () => {
    if (!uploadedFileKey || !file) {
      setError("Сначала загрузите файл");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // TODO: US-3 - Preview структуры
      // TODO: US-4 - Маппинг полей
      // TODO: US-5 - Настройка иерархии
      
      // Временная заглушка для тестирования инфраструктуры
      const mappingConfig = {
        fields: [
          { sourcePath: "id", role: "id" as const },
          { sourcePath: "title", role: "title" as const },
          { sourcePath: "content", role: "content" as const },
        ],
      };

      const hierarchyConfig = {
        mode: "flat" as const,
      };

      const request: CreateJsonImportRequest = {
        fileKey: uploadedFileKey,
        fileName: file.name,
        fileSize: file.size,
        mappingConfig,
        hierarchyConfig,
      };

      const response = await apiRequest(
        "POST",
        `/api/knowledge/bases/${baseId}/json-import`,
        request,
        undefined,
        { workspaceId },
      );

      const data = (await response.json()) as { jobId: string; status: "pending" };

      toast({
        title: "Импорт запущен",
        description: "Импорт JSON/JSONL начат. Вы можете закрыть это окно и отслеживать прогресс.",
      });

      onImportStarted?.(data.jobId);
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось запустить импорт";
      setError(message);
      toast({
        variant: "destructive",
        title: "Ошибка импорта",
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting && !isUploading) {
      if (isUploading) {
        abort();
      }
      setFile(null);
      setUploadedFileKey(null);
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Импорт JSON/JSONL
          </DialogTitle>
          <DialogDescription>
            Загрузите файл JSON или JSONL для импорта в базу знаний. Файл будет обработан в фоновом режиме.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <AlertDescription>
              В MVP доступна базовая функциональность. Полный мастер с предпросмотром и настройкой маппинга будет добавлен в следующих версиях.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="json-import-file">Файл JSON/JSONL</Label>
            <Input
              id="json-import-file"
              type="file"
              accept=".json,.jsonl"
              onChange={handleFileChange}
              disabled={isSubmitting || isUploading}
            />
            {file && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Выбран: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
                {!uploadedFileKey && !isUploading && (
                  <Button
                    type="button"
                    onClick={handleFileUpload}
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    Загрузить файл
                  </Button>
                )}
                {isUploading && uploadProgress && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Загрузка части {uploadProgress.currentPart} из {uploadProgress.totalParts}
                      </span>
                      <span className="font-medium">{uploadProgress.percent}%</span>
                    </div>
                    <Progress value={uploadProgress.percent} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={abort}
                      className="w-full"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Отменить загрузку
                    </Button>
                  </div>
                )}
                {uploadedFileKey && (
                  <Alert>
                    <AlertDescription>
                      Файл успешно загружен. Теперь можно запустить импорт.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          {(error || uploadError) && (
            <Alert variant="destructive">
              <AlertDescription>{error || uploadError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting || isUploading}>
            {isUploading ? "Отмена" : "Закрыть"}
          </Button>
          <Button
            onClick={handleStartImport}
            disabled={isSubmitting || isUploading || !uploadedFileKey}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Запускаем...
              </>
            ) : (
              "Запустить импорт"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

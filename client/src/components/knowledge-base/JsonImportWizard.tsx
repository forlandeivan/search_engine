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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, FileJson } from "lucide-react";
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setError(null);
  };

  const handleSubmit = async () => {
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

    setIsSubmitting(true);
    setError(null);

    try {
      // TODO: US-2 - Загрузка файла в S3
      // TODO: US-3 - Preview структуры
      // TODO: US-4 - Маппинг полей
      // TODO: US-5 - Настройка иерархии
      
      // Временная заглушка для тестирования инфраструктуры
      const fileKey = `json-imports/temp/${Date.now()}/${file.name}`;
      
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
        fileKey,
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
    if (!isSubmitting) {
      setFile(null);
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
              disabled={isSubmitting}
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                Выбран: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !file}>
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

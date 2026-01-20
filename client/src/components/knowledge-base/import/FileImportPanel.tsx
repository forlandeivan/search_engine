import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AlertCircle, FileText, Loader2, Trash2, Upload } from "lucide-react";
import type { ProcessedFileResult } from "./types";

const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.pptx,.xlsx,.txt,.md,.markdown,.html,.htm,.eml,.csv" +
  ",application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" +
  ",application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" +
  ",text/plain,text/markdown,text/csv,text/html,message/rfc822";

const SUPPORTED_FORMAT_LABEL = "PDF, DOC, DOCX, TXT, Markdown, HTML, CSV, EML, PPTX, XLSX";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export type FileImportMode = "single" | "multiple" | "archive";

type FileImportPanelProps = {
  // Режим работы
  mode?: FileImportMode; // "single" | "multiple" | "archive"
  onModeChange?: (mode: FileImportMode) => void;
  multiple?: boolean; // Разрешить несколько файлов (устаревшее, используйте mode)
  allowArchives?: boolean; // Разрешить ZIP/RAR/7z (устаревшее, используйте mode)

  // Состояние
  files: File[];
  onFilesChange: (files: File[]) => void;

  // Обработка файлов
  onFilesProcessed?: (results: ProcessedFileResult[]) => void;
  isProcessing?: boolean;
  processingProgress?: { current: number; total: number };

  // Ошибки
  error?: string | null;

  // Ограничения
  maxFileSize?: number;
  acceptedTypes?: string;

  disabled?: boolean;
};

export function FileImportPanel({
  mode: externalMode,
  onModeChange: externalOnModeChange,
  multiple = false,
  allowArchives = false,
  files,
  onFilesChange,
  onFilesProcessed,
  isProcessing = false,
  processingProgress,
  error,
  maxFileSize = MAX_FILE_SIZE_BYTES,
  acceptedTypes = ACCEPTED_FILE_TYPES,
  disabled,
}: FileImportPanelProps) {
  const [internalMode, setInternalMode] = useState<FileImportMode>(
    allowArchives ? "archive" : multiple ? "multiple" : "single"
  );
  const [isDragActive, setIsDragActive] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Используем внешний mode если передан, иначе внутренний
  const mode = externalMode ?? internalMode;
  const handleModeChange = externalOnModeChange ?? setInternalMode;

  const getAcceptTypes = () => {
    if (mode === "archive") {
      return ".zip,.rar,.7z";
    }
    return acceptedTypes;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length === 0) {
      return;
    }

    if (mode === "single" && selectedFiles.length > 1) {
      onFilesChange([selectedFiles[0]]);
    } else {
      onFilesChange([...files, ...selectedFiles]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);

    const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
    if (droppedFiles.length === 0) {
      return;
    }

    if (mode === "single" && droppedFiles.length > 1) {
      onFilesChange([droppedFiles[0]]);
    } else {
      onFilesChange([...files, ...droppedFiles]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    onFilesChange(newFiles);
  };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Toggle режима (если не передан внешний mode) */}
      {!externalMode && (
        <div className="flex items-center gap-4">
          <Label>Режим импорта:</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "single" ? "default" : "outline"}
              size="sm"
              onClick={() => handleModeChange("single")}
              disabled={disabled}
            >
              Один файл
            </Button>
            <Button
              type="button"
              variant={mode === "multiple" ? "default" : "outline"}
              size="sm"
              onClick={() => handleModeChange("multiple")}
              disabled={disabled}
            >
              Несколько файлов
            </Button>
            {allowArchives && (
              <Button
                type="button"
                variant={mode === "archive" ? "default" : "outline"}
                size="sm"
                onClick={() => handleModeChange("archive")}
                disabled={disabled}
              >
                ZIP-архив
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Drag & Drop зона */}
      <div className="space-y-2">
        <Label htmlFor="file-import-input">
          {mode === "archive" ? "ZIP-архив документов" : mode === "multiple" ? "Файлы документов" : "Файл документа"}
        </Label>
        <div
          className={cn(
            "flex flex-col gap-3 rounded-md border border-dashed p-4 text-sm transition",
            isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30",
          )}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleFileDrop}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={fileInputRef}
              id="file-import-input"
              type="file"
              accept={getAcceptTypes()}
              multiple={mode === "multiple"}
              onChange={handleFileChange}
              disabled={disabled || isProcessing || isReadingFile}
              className="cursor-pointer"
            />
            {(isProcessing || isReadingFile) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "archive"
              ? "Перетащите архив сюда или выберите на компьютере. Поддерживаются ZIP, RAR и 7z архивы."
              : mode === "multiple"
                ? `Перетащите файлы сюда или выберите на компьютере. Максимальный размер — ${(maxFileSize / 1024 / 1024).toFixed(0)} МБ на файл. Поддерживаются ${SUPPORTED_FORMAT_LABEL}.`
                : `Перетащите файл сюда или выберите на компьютере. Максимальный размер — ${(maxFileSize / 1024 / 1024).toFixed(0)} МБ. Поддерживаются ${SUPPORTED_FORMAT_LABEL}.`}
          </p>

          {/* Список выбранных файлов */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Всего: {files.length} {files.length === 1 ? "файл" : files.length < 5 ? "файла" : "файлов"}, {totalSizeMB} МБ
                </span>
                {files.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onFilesChange([])}
                    disabled={disabled || isProcessing}
                    className="h-6 px-2 text-xs"
                  >
                    Очистить все
                  </Button>
                )}
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-muted-foreground/20 bg-muted/40 p-2 text-xs text-muted-foreground"
                  >
                    <FileText className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate">
                      {file.name} · {(file.size / 1024).toFixed(1)} КБ
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(index)}
                      disabled={disabled || isProcessing}
                      className="h-6 px-2 flex-shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Прогресс обработки */}
          {isProcessing && processingProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Обработка файлов... ({processingProgress.current} из {processingProgress.total})
                </span>
                <span className="font-medium">
                  {Math.round((processingProgress.current / processingProgress.total) * 100)}%
                </span>
              </div>
              <Progress value={(processingProgress.current / processingProgress.total) * 100} />
            </div>
          )}

          {/* Ошибки */}
          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { FileText, FileType, File as FileIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentAttachmentProps {
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  /** Показывать ошибку только если файл ВООБЩЕ не удалось обработать */
  hasCriticalError?: boolean;
  errorMessage?: string;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(mimeType: string | null) {
  if (mimeType?.includes('pdf')) {
    return <FileType className="h-5 w-5" />;
  }
  if (mimeType?.includes('word') || mimeType?.includes('document')) {
    return <FileIcon className="h-5 w-5" />;
  }
  return <FileText className="h-5 w-5" />;
}

export function DocumentAttachment({
  filename,
  mimeType,
  sizeBytes,
  hasCriticalError,
  errorMessage,
  className,
}: DocumentAttachmentProps) {
  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/50",
      hasCriticalError && "border-destructive/50 bg-destructive/5",
      className
    )}>
      {/* Иконка файла */}
      <div className={cn(
        "flex-shrink-0",
        hasCriticalError ? "text-destructive" : "text-muted-foreground"
      )}>
        {hasCriticalError ? (
          <AlertCircle className="h-5 w-5" />
        ) : (
          getFileIcon(mimeType)
        )}
      </div>
      
      {/* Информация о файле */}
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate max-w-[200px]" title={filename}>
          {filename}
        </span>
        <span className="text-xs text-muted-foreground">
          {hasCriticalError ? (
            <span className="text-destructive">
              {errorMessage || "Не удалось обработать"}
            </span>
          ) : (
            formatBytes(sizeBytes)
          )}
        </span>
      </div>
    </div>
  );
}

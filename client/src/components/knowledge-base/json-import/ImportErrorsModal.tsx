import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import type { ImportRecordError, ErrorType } from "@shared/json-import";

interface ImportErrorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  workspaceId: string;
}

const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  parse_error: "Ошибка парсинга",
  validation_error: "Ошибка валидации",
  mapping_error: "Ошибка маппинга",
  duplicate: "Дубликат",
  database_error: "Ошибка БД",
  unknown: "Неизвестная ошибка",
};

const ERROR_TYPE_VARIANTS: Record<ErrorType, "default" | "secondary" | "destructive" | "outline"> = {
  parse_error: "destructive",
  validation_error: "destructive",
  mapping_error: "destructive",
  duplicate: "secondary",
  database_error: "destructive",
  unknown: "outline",
};

interface ErrorsResponse {
  errors: ImportRecordError[];
  total: number;
  summary: {
    parseErrors: number;
    validationErrors: number;
    mappingErrors: number;
    duplicates: number;
    databaseErrors: number;
    unknownErrors: number;
  };
}

export function ImportErrorsModal({
  open,
  onOpenChange,
  jobId,
  workspaceId,
}: ImportErrorsModalProps) {
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const { data, isLoading, refetch } = useQuery<ErrorsResponse>({
    queryKey: ["json-import-errors", jobId, workspaceId, errorTypeFilter, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        offset: offset.toString(),
        limit: limit.toString(),
      });
      if (errorTypeFilter !== "all") {
        params.append("errorType", errorTypeFilter);
      }

      const res = await apiRequest(
        "GET",
        `/api/knowledge/json-import/${jobId}/errors?${params.toString()}`,
        undefined,
        undefined,
        { workspaceId },
      );
      return (await res.json()) as ErrorsResponse;
    },
    enabled: open && Boolean(jobId),
  });

  const handleExport = async (format: "csv" | "json") => {
    try {
      const res = await apiRequest(
        "GET",
        `/api/knowledge/json-import/${jobId}/errors/export?format=${format}`,
        undefined,
        undefined,
        { workspaceId },
      );

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `json-import-errors-${jobId.slice(0, 8)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Ошибка экспорта:", error);
    }
  };

  const handlePreviousPage = () => {
    if (offset >= limit) {
      setOffset(offset - limit);
    }
  };

  const handleNextPage = () => {
    if (data && offset + limit < data.total) {
      setOffset(offset + limit);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Ошибки импорта</DialogTitle>
          <DialogDescription>
            Детальный список всех ошибок, возникших при импорте
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <Select value={errorTypeFilter} onValueChange={(value) => {
            setErrorTypeFilter(value);
            setOffset(0);
          }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Фильтр по типу" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              {Object.entries(ERROR_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("json")}>
              <Download className="mr-2 h-4 w-4" />
              JSON
            </Button>
          </div>
        </div>

        {data && data.summary && (
          <div className="flex flex-wrap gap-2 text-sm">
            {data.summary.parseErrors > 0 && (
              <Badge variant="destructive">
                Ошибки парсинга: {data.summary.parseErrors}
              </Badge>
            )}
            {data.summary.validationErrors > 0 && (
              <Badge variant="destructive">
                Ошибки валидации: {data.summary.validationErrors}
              </Badge>
            )}
            {data.summary.mappingErrors > 0 && (
              <Badge variant="destructive">
                Ошибки маппинга: {data.summary.mappingErrors}
              </Badge>
            )}
            {data.summary.duplicates > 0 && (
              <Badge variant="secondary">
                Дубликаты: {data.summary.duplicates}
              </Badge>
            )}
            {data.summary.databaseErrors > 0 && (
              <Badge variant="destructive">
                Ошибки БД: {data.summary.databaseErrors}
              </Badge>
            )}
            {data.summary.unknownErrors > 0 && (
              <Badge variant="outline">
                Неизвестные: {data.summary.unknownErrors}
              </Badge>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-sm text-muted-foreground">Загрузка ошибок...</p>
            </div>
          ) : data && data.errors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Строка</TableHead>
                  <TableHead>Индекс</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Сообщение</TableHead>
                  <TableHead>Поле</TableHead>
                  <TableHead>Превью</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.errors.map((error, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">
                      {error.lineNumber ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {error.recordIndex ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ERROR_TYPE_VARIANTS[error.errorType]}>
                        {ERROR_TYPE_LABELS[error.errorType]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <p className="text-sm truncate" title={error.message}>
                        {error.message}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {error.field || "—"}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {error.rawPreview ? (
                        <p className="text-xs text-muted-foreground truncate" title={error.rawPreview}>
                          {error.rawPreview}
                        </p>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center p-8">
              <p className="text-sm text-muted-foreground">Ошибок не найдено</p>
            </div>
          )}
        </ScrollArea>

        {data && data.total > limit && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Показано {offset + 1}—{Math.min(offset + limit, data.total)} из {data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousPage}
                disabled={offset === 0}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={offset + limit >= data.total}
              >
                Вперёд
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

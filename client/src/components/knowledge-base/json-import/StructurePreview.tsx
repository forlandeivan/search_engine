import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, FileJson, Info } from "lucide-react";
import type { StructureAnalysis } from "@/lib/json-import-types";

interface StructurePreviewProps {
  analysis: StructureAnalysis;
  isLoading?: boolean;
}

export function StructurePreview({ analysis, isLoading }: StructurePreviewProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Анализ структуры файла...</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Пожалуйста, подождите</p>
        </CardContent>
      </Card>
    );
  }

  const formatLabel = analysis.format === "json_array" ? "JSON-массив" : "JSONL";
  const formatBadgeVariant = analysis.format === "json_array" ? "default" : "secondary";

  return (
    <div className="space-y-4">
      {/* Формат и статистика */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Информация о файле
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Формат:</span>
            <Badge variant={formatBadgeVariant}>{formatLabel}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Записей (примерно):</span>
            <span className="text-sm text-muted-foreground">{analysis.estimatedRecordCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Размер файла:</span>
            <span className="text-sm text-muted-foreground">
              {(analysis.fileSize / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Предупреждения */}
      {analysis.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {analysis.warnings.map((warning, idx) => (
                <p key={idx}>{warning.message}</p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Список полей */}
      <Card>
        <CardHeader>
          <CardTitle>Найденные поля</CardTitle>
          <CardDescription>
            Список всех полей, найденных в файле, с типами данных и частотой встречаемости
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analysis.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Поля не найдены</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Поле</TableHead>
                  <TableHead>Путь</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Частота</TableHead>
                  <TableHead>Примеры значений</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.fields.map((field) => (
                  <TableRow key={field.path}>
                    <TableCell className="font-medium">{field.key}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{field.path}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{field.type}</Badge>
                    </TableCell>
                    <TableCell>{field.frequency}%</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {field.sampleValues.length > 0 ? (
                        <div className="space-y-1">
                          {field.sampleValues.map((value, idx) => (
                            <div key={idx} className="truncate max-w-xs">
                              {value}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Примеры записей */}
      {analysis.sampleRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Примеры записей</CardTitle>
            <CardDescription>Первые {analysis.sampleRecords.length} записей из файла</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analysis.sampleRecords.map((record, idx) => (
                <div key={idx} className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">Запись {idx + 1}</Badge>
                  </div>
                  <pre className="text-xs overflow-auto max-h-64 bg-muted p-2 rounded">
                    {JSON.stringify(record, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {analysis.fields.length === 0 && analysis.sampleRecords.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Файл не содержит записей или не удалось проанализировать структуру.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

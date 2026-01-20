/**
 * @deprecated Use DocumentFieldMappingEditor instead
 * This component will be removed in version 1.58
 */
import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FieldInfo, StructureAnalysis } from "@/lib/json-import-types";
import type { FieldMapping, MappingConfig, FieldRole } from "@shared/json-import";

interface FieldMappingEditorProps {
  analysis: StructureAnalysis;
  initialMapping?: MappingConfig;
  onMappingChange: (mapping: MappingConfig) => void;
  onValidationChange?: (isValid: boolean) => void;
  showValidationErrors?: boolean;
}

const FIELD_ROLES: Array<{ value: FieldRole; label: string; description: string }> = [
  { value: "skip", label: "Пропустить", description: "Поле не будет использовано" },
  { value: "id", label: "ID", description: "Идентификатор для дедупликации" },
  { value: "title", label: "Заголовок", description: "Заголовок документа" },
  { value: "content", label: "Контент", description: "Основной текст документа" },
  { value: "content_html", label: "Контент (HTML)", description: "HTML версия контента" },
  { value: "content_md", label: "Контент (Markdown)", description: "Markdown версия контента" },
  { value: "metadata", label: "Метаданные", description: "Дополнительные данные" },
];

/**
 * Автоматическое предложение маппинга на основе имён полей
 */
function suggestMapping(fields: FieldInfo[]): MappingConfig {
  const TITLE_PATTERNS = ["title", "name", "header", "subject", "heading", "название", "заголовок"];
  const CONTENT_PATTERNS = ["content", "text", "body", "description", "article", "контент", "текст"];
  const ID_PATTERNS = ["id", "_id", "uuid", "key", "identifier"];

  const suggestions: FieldMapping[] = [];
  let contentPriority = 1;

  for (const field of fields) {
    const lowerName = field.key.toLowerCase();
    const lowerPath = field.path.toLowerCase();

    if (ID_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "id" });
    } else if (TITLE_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "title" });
    } else if (CONTENT_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "content", priority: contentPriority++ });
    } else {
      suggestions.push({ sourcePath: field.path, role: "metadata" });
    }
  }

  return {
    fields: suggestions,
    contentJoinSeparator: "\n\n",
    titleFallback: "first_line",
  };
}

/**
 * Валидация маппинга
 */
function validateMapping(mappingConfig: MappingConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Проверяем наличие поля для контента
  const hasContentField = mappingConfig.fields.some(
    (f) => f.role === "content" || f.role === "content_html" || f.role === "content_md",
  );

  if (!hasContentField) {
    errors.push("Выберите хотя бы одно поле для контента документа");
  }

  // Проверяем дубликаты ID
  const idFields = mappingConfig.fields.filter((f) => f.role === "id");
  if (idFields.length > 1) {
    warnings.push(`Найдено несколько полей с ролью "ID". Будет использовано первое: ${idFields[0].sourcePath}`);
  }

  // Проверяем дубликаты title
  const titleFields = mappingConfig.fields.filter((f) => f.role === "title");
  if (titleFields.length > 1) {
    warnings.push(`Найдено несколько полей с ролью "Заголовок". Будет использовано первое: ${titleFields[0].sourcePath}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Применить маппинг к примеру записи для предпросмотра
 */
function applyMappingToRecord(record: Record<string, unknown>, mapping: MappingConfig): {
  id?: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
} {
  const result: {
    id?: string;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  } = {
    title: "",
    content: "",
    metadata: {},
  };

  const contentParts: string[] = [];

  // Сортируем поля по priority (если есть)
  const sortedFields = [...mapping.fields].sort((a, b) => {
    const aPriority = a.priority ?? 0;
    const bPriority = b.priority ?? 0;
    return aPriority - bPriority;
  });

  for (const field of sortedFields) {
    if (field.role === "skip") {
      continue;
    }

    // Получаем значение из вложенного объекта
    const parts = field.sourcePath.split(".");
    let value: unknown = record;
    for (const part of parts) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }

    if (value === undefined || value === null) {
      continue;
    }

    const stringValue = String(value);

    switch (field.role) {
      case "id":
        if (!result.id) {
          result.id = stringValue;
        }
        break;
      case "title":
        if (!result.title) {
          result.title = stringValue;
        }
        break;
      case "content":
      case "content_html":
      case "content_md":
        contentParts.push(stringValue);
        break;
      case "metadata":
        result.metadata[field.sourcePath] = value;
        break;
    }
  }

  // Объединяем контент
  const separator = mapping.contentJoinSeparator ?? "\n\n";
  result.content = contentParts.join(separator);

  // Fallback для title
  if (!result.title) {
    if (mapping.titleFallback === "first_line" && result.content) {
      result.title = result.content.split("\n")[0].slice(0, 200);
    } else if (mapping.titleFallback === "content_excerpt" && result.content) {
      result.title = result.content.slice(0, 200);
    } else {
      result.title = "Без названия";
    }
  }

  return result;
}

export function FieldMappingEditor({
  analysis,
  initialMapping,
  onMappingChange,
  onValidationChange,
  showValidationErrors = false,
}: FieldMappingEditorProps) {
  const initialMappingValue = useMemo(() => {
    return initialMapping ?? {
      fields: analysis.fields.map((f) => ({ sourcePath: f.path, role: "skip" as FieldRole })),
    };
  }, [initialMapping, analysis.fields]);

  const [mapping, setMapping] = useState<MappingConfig>(initialMappingValue);

  // Обновляем mapping при изменении initialMapping
  useEffect(() => {
    if (initialMapping) {
      setMapping(initialMapping);
    }
  }, [initialMapping]);

  // Вызываем onMappingChange при инициализации, чтобы родитель знал о текущем маппинге
  useEffect(() => {
    if (!initialMapping) {
      // Если initialMapping не предоставлен, сообщаем родителю о созданном начальном маппинге
      onMappingChange(initialMappingValue);
    }
    // Если initialMapping предоставлен, он уже должен быть известен родителю
  }, []); // Только при монтировании

  const validation = useMemo(() => validateMapping(mapping), [mapping]);

  // Уведомляем родителя об изменении валидности всегда (для блокировки кнопок)
  // showValidationErrors только контролирует отображение ошибок
  useMemo(() => {
    onValidationChange?.(validation.valid);
  }, [validation.valid, onValidationChange]);

  const handleRoleChange = (fieldPath: string, newRole: FieldRole) => {
    const newFields = mapping.fields.map((f) =>
      f.sourcePath === fieldPath ? { ...f, role: newRole } : f,
    );
    const newMapping = { ...mapping, fields: newFields };
    setMapping(newMapping);
    onMappingChange(newMapping);
  };

  const handleApplySuggestions = () => {
    const suggested = suggestMapping(analysis.fields);
    setMapping(suggested);
    onMappingChange(suggested);
  };

  // Предпросмотр на основе первой записи
  const preview = useMemo(() => {
    if (analysis.sampleRecords.length === 0) {
      return null;
    }
    return applyMappingToRecord(analysis.sampleRecords[0], mapping);
  }, [analysis.sampleRecords, mapping]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Настройка маппинга полей</h3>
          <p className="text-sm text-muted-foreground">
            Выберите назначение для каждого поля из JSON файла
          </p>
        </div>
        <Button type="button" variant="outline" onClick={handleApplySuggestions}>
          <Sparkles className="mr-2 h-4 w-4" />
          Применить автоматические предложения
        </Button>
      </div>

      {/* Ошибки и предупреждения - показываем только если showValidationErrors = true */}
      {showValidationErrors && validation.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {validation.errors.map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {validation.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {validation.warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Таблица полей */}
      <Card>
        <CardHeader>
          <CardTitle>Поля</CardTitle>
          <CardDescription>
            Выберите назначение для каждого поля. Поле "Контент" обязательно.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-w-full">
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[100px]">Поле</TableHead>
                  <TableHead className="min-w-[150px]">Путь</TableHead>
                  <TableHead className="min-w-[80px]">Тип</TableHead>
                  <TableHead className="min-w-[180px]">Назначение</TableHead>
                  <TableHead className="min-w-[150px] max-w-[250px]">Пример значения</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.fields.map((field) => {
                  const fieldMapping = mapping.fields.find((f) => f.sourcePath === field.path);
                  const currentRole = fieldMapping?.role ?? "skip";

                  return (
                    <TableRow key={field.path}>
                      <TableCell className="font-medium break-words">{field.key}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs break-all max-w-[200px]">
                        {field.path}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{field.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Select value={currentRole} onValueChange={(value) => handleRoleChange(field.path, value as FieldRole)}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_ROLES.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                <div>
                                  <div className="font-medium">{role.label}</div>
                                  <div className="text-xs text-muted-foreground">{role.description}</div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[250px]">
                        {field.sampleValues.length > 0 ? (
                          <div className="break-words overflow-hidden line-clamp-2">
                            {String(field.sampleValues[0])}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Предпросмотр */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Предпросмотр документа</CardTitle>
            <CardDescription>Как будет выглядеть документ после маппинга</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.id && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">ID</div>
                <div className="text-sm">{preview.id}</div>
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Заголовок</div>
              <div className="text-sm font-semibold">{preview.title || "Без названия"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Контент</div>
              <div className="text-sm whitespace-pre-wrap max-h-48 overflow-auto border rounded p-2 break-words">
                {preview.content || "(пусто)"}
              </div>
            </div>
            {Object.keys(preview.metadata).length > 0 && (
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Метаданные</div>
                <pre className="text-xs bg-muted p-2 rounded overflow-auto break-words whitespace-pre-wrap">
                  {JSON.stringify(preview.metadata, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {validation.valid && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>Маппинг настроен корректно. Можно переходить к следующему шагу.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Sparkles, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { randomUUID } from "@/lib/utils";
import type { SchemaFieldConfig } from "@shared/knowledge-base-indexing";
import { DEFAULT_SCHEMA_FIELDS, COLLECTION_FIELD_TYPES } from "@shared/knowledge-base-indexing";
import { createFieldToken } from "@shared/json-import";
import { SchemaFieldEditor } from "./SchemaFieldEditor";

interface SchemaFieldsStepProps {
  config: {
    schemaFields: SchemaFieldConfig[];
  };
  onChange: (config: { schemaFields: SchemaFieldConfig[] }) => void;
  workspaceId: string;
  baseId: string;
  disabled?: boolean;
}

interface SuggestedField {
  name: string;
  type: (typeof COLLECTION_FIELD_TYPES)[number];
  expression: SchemaFieldConfig["expression"];
  reason: string;
}

export function SchemaFieldsStep({
  config,
  onChange,
  workspaceId,
  baseId,
  disabled,
}: SchemaFieldsStepProps) {
  const [fields, setFields] = useState<SchemaFieldConfig[]>(config.schemaFields);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showSuggestDialog, setShowSuggestDialog] = useState(false);

  // Загрузка ключей метаданных для автоподбора
  const { data: metadataKeys, isLoading: metadataLoading } = useQuery<string[]>({
    queryKey: ["knowledge-base-metadata-keys", baseId, workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/knowledge/bases/${baseId}/metadata-keys`, undefined, undefined, {
        workspaceId,
      });
      if (!res.ok) {
        return [];
      }
      return (await res.json()) as string[];
    },
    enabled: false, // Загружаем только по запросу
  });

  // Валидация имени поля
  const validateFieldName = (name: string, excludeId?: string): string | null => {
    if (!name.trim()) {
      return "Имя поля обязательно";
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return "Имя поля может содержать только латиницу, цифры и подчеркивание, и не должно начинаться с цифры";
    }
    if (name.length > 120) {
      return "Имя поля не должно превышать 120 символов";
    }
    // Проверка уникальности
    const duplicate = fields.find((f) => f.id !== excludeId && f.name === name);
    if (duplicate) {
      return "Поле с таким именем уже существует";
    }
    return null;
  };

  // Обновление поля
  const handleFieldChange = (updatedField: SchemaFieldConfig) => {
    const error = validateFieldName(updatedField.name, updatedField.id);
    if (error) {
      setFieldErrors((prev) => ({ ...prev, [updatedField.id]: error }));
    } else {
      setFieldErrors((prev => {
        const next = { ...prev };
        delete next[updatedField.id];
        return next;
      }));
    }

    const newFields = fields.map((f) => (f.id === updatedField.id ? updatedField : f));
    setFields(newFields);
    onChange({ schemaFields: newFields });
  };

  // Добавление нового поля
  const handleAddField = () => {
    if (fields.length >= 50) {
      return;
    }
    const newField: SchemaFieldConfig = {
      id: randomUUID(),
      name: "",
      type: "keyword",
      isArray: false,
      expression: [],
    };
    const newFields = [...fields, newField];
    setFields(newFields);
    onChange({ schemaFields: newFields });
  };

  // Удаление поля
  const handleDeleteField = (fieldId: string) => {
    const newFields = fields.filter((f) => f.id !== fieldId);
    setFields(newFields);
    onChange({ schemaFields: newFields });
  };

  // Автоподбор полей
  const handleSuggestFields = async () => {
    // TODO: Реализовать логику автоподбора
    // Пока просто показываем заглушку
    setShowSuggestDialog(true);
  };

  // Поле для векторизации (обязательное)
  const embeddingField = useMemo(() => fields.find((f) => f.isEmbeddingField), [fields]);
  const additionalFields = useMemo(() => fields.filter((f) => !f.isEmbeddingField), [fields]);

  // Проверка, что есть поле для векторизации
  const hasEmbeddingField = embeddingField !== undefined;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Шаг 3: Схема полей payload</h3>
        <p className="text-sm text-muted-foreground">
          Настройте поля, которые будут сохранены вместе с векторами в Qdrant. Эти поля доступны для фильтрации при
          поиске.
        </p>
      </div>

      {/* Поле для векторизации */}
      {embeddingField && (
        <div className="space-y-2">
          <SchemaFieldEditor
            field={embeddingField}
            onChange={handleFieldChange}
            isEmbeddingField={true}
            disabled={disabled}
            workspaceId={workspaceId}
          />
        </div>
      )}

      {/* Дополнительные поля */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Дополнительные поля</CardTitle>
            <CardDescription>Добавьте поля для фильтрации и поиска</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddField}
            disabled={disabled || fields.length >= 50}
          >
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {additionalFields.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Нет дополнительных полей. Нажмите "Добавить" для создания нового поля.
            </p>
          ) : (
            additionalFields.map((field) => (
              <div key={field.id} className="space-y-2">
                {fieldErrors[field.id] && (
                  <Alert variant="destructive" className="py-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{fieldErrors[field.id]}</AlertDescription>
                  </Alert>
                )}
                <SchemaFieldEditor
                  field={field}
                  onChange={handleFieldChange}
                  onDelete={() => handleDeleteField(field.id)}
                  disabled={disabled}
                  workspaceId={workspaceId}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Кнопка автоподбора */}
      <Card>
        <CardContent className="pt-6">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleSuggestFields}
            disabled={disabled || metadataLoading}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Подобрать поля автоматически
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Система предложит поля на основе метаданных документов
          </p>
        </CardContent>
      </Card>

      {/* Предупреждения */}
      {!hasEmbeddingField && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Необходимо указать поле для векторизации. Добавьте поле с флагом isEmbeddingField.
          </AlertDescription>
        </Alert>
      )}

      {fields.length >= 50 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Достигнут лимит полей (50). Удалите некоторые поля перед добавлением новых.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

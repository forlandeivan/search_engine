import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpressionInput } from "../json-import/ExpressionInput";
import { Trash2, Lock } from "lucide-react";
import type { SchemaFieldConfig } from "@shared/knowledge-base-indexing";
import { COLLECTION_FIELD_TYPES, INDEXING_TEMPLATE_VARIABLES } from "@shared/knowledge-base-indexing";
import type { FieldInfo } from "@/lib/json-import-types";

interface SchemaFieldEditorProps {
  field: SchemaFieldConfig;
  onChange: (field: SchemaFieldConfig) => void;
  onDelete?: () => void;
  isEmbeddingField?: boolean;
  disabled?: boolean;
  workspaceId: string;
}

// Преобразование INDEXING_TEMPLATE_VARIABLES в FieldInfo для ExpressionInput
const indexingFields: FieldInfo[] = INDEXING_TEMPLATE_VARIABLES.map((variable) => ({
  key: variable.name,
  path: variable.name,
  type: "string", // По умолчанию все строки, но это не критично для UI
  description: variable.description,
}));

export function SchemaFieldEditor({
  field,
  onChange,
  onDelete,
  isEmbeddingField = false,
  disabled,
  workspaceId,
}: SchemaFieldEditorProps) {
  const [name, setName] = useState(field.name);
  const [type, setType] = useState(field.type);
  const [isArray, setIsArray] = useState(field.isArray);
  const [expression, setExpression] = useState(field.expression);

  // Обновление при изменении внешнего field
  if (field.name !== name || field.type !== type || field.isArray !== isArray) {
    setName(field.name);
    setType(field.type);
    setIsArray(field.isArray);
  }

  const handleNameChange = (newName: string) => {
    setName(newName);
    onChange({ ...field, name: newName });
  };

  const handleTypeChange = (newType: string) => {
    setType(newType as typeof field.type);
    onChange({ ...field, type: newType as typeof field.type });
  };

  const handleIsArrayChange = (checked: boolean) => {
    setIsArray(checked);
    onChange({ ...field, isArray: checked });
  };

  const handleExpressionChange = (newExpression: typeof field.expression) => {
    setExpression(newExpression);
    onChange({ ...field, expression: newExpression });
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-4">
            {/* Заголовок с иконкой блокировки для embedding поля */}
            <div className="flex items-center gap-2">
              {isEmbeddingField && <Lock className="h-4 w-4 text-muted-foreground" />}
              <span className="text-sm font-medium">
              {isEmbeddingField ? "Поле для векторизации (обязательное)" : "Дополнительное поле"}
            </span>
            </div>

            {/* Имя и тип */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`field-name-${field.id}`}>Имя поля</Label>
                <Input
                  id={`field-name-${field.id}`}
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={disabled || isEmbeddingField}
                  placeholder="title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`field-type-${field.id}`}>Тип</Label>
                <Select value={type} onValueChange={handleTypeChange} disabled={disabled || isEmbeddingField}>
                  <SelectTrigger id={`field-type-${field.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLLECTION_FIELD_TYPES.map((fieldType) => (
                      <SelectItem key={fieldType} value={fieldType}>
                        {fieldType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Checkbox массива */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`field-array-${field.id}`}
                checked={isArray}
                onCheckedChange={(checked) => handleIsArrayChange(checked === true)}
                disabled={disabled || isEmbeddingField}
              />
              <Label htmlFor={`field-array-${field.id}`} className="text-sm font-normal cursor-pointer">
                Массив значений
              </Label>
            </div>

            {/* ExpressionInput */}
            <div className="space-y-2">
              <Label>Выражение для формирования значения</Label>
              <ExpressionInput
                value={expression}
                onChange={handleExpressionChange}
                availableFields={indexingFields}
                placeholder="Введите выражение или нажмите Ctrl+Space для вставки полей..."
                disabled={disabled}
              />
            </div>

            {/* Подсказка для embedding поля */}
            {isEmbeddingField && (
              <p className="text-xs text-muted-foreground">
                ℹ️ Это поле используется для создания эмбеддингов. Содержимое этого поля будет векторизовано.
              </p>
            )}
          </div>

          {/* Кнопка удаления */}
          {!isEmbeddingField && onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={disabled}
              className="flex-shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

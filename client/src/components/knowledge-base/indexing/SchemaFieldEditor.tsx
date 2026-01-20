import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { ExpressionInput } from "../json-import/ExpressionInput";
import { Trash2, Lock } from "lucide-react";
import type { SchemaFieldConfig } from "@shared/knowledge-base-indexing";
import { INDEXING_TEMPLATE_VARIABLES } from "@shared/knowledge-base-indexing";
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
  type: "string",
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

  // Обновление при изменении внешнего field
  if (field.name !== name) {
    setName(field.name);
  }
  
  // Используем expression напрямую из field для корректного отображения
  const expression = field.expression;

  const handleNameChange = (newName: string) => {
    setName(newName);
    onChange({ ...field, name: newName });
  };

  const handleExpressionChange = (newExpression: typeof field.expression) => {
    onChange({ ...field, expression: newExpression });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <div className="flex-1 space-y-4">
            {/* Заголовок */}
            <div className="flex items-center gap-2">
              {isEmbeddingField && <Lock className="h-4 w-4 text-muted-foreground" />}
              <CardTitle className="text-base">
                {isEmbeddingField ? "Контент для векторизации" : "Дополнительное поле"}
              </CardTitle>
            </div>

            {/* Имя поля и Значение в одну строку */}
            <div className="grid grid-cols-2 gap-4">
              {/* Имя поля */}
              <div className="space-y-2">
                <Label htmlFor={`field-name-${field.id}`}>Имя поля</Label>
                <Input
                  id={`field-name-${field.id}`}
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={disabled || isEmbeddingField}
                  placeholder={isEmbeddingField ? "content" : "category"}
                />
              </div>

              {/* Значение */}
              <div className="space-y-2">
                <Label htmlFor={`field-value-${field.id}`}>Значение</Label>
                <ExpressionInput
                  value={expression}
                  onChange={handleExpressionChange}
                  availableFields={indexingFields}
                  placeholder="Введите выражение..."
                  disabled={disabled || isEmbeddingField}
                />
              </div>
            </div>

            {/* Подсказка для embedding поля */}
            {isEmbeddingField && (
              <p className="text-xs text-muted-foreground">
                Это содержимое будет векторизовано и использовано для поиска
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
              className="flex-shrink-0 mt-8"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

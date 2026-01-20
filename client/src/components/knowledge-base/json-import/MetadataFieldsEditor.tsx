import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2, AlertTriangle, GripVertical } from "lucide-react";
import { ExpressionInput } from "./ExpressionInput";
import type { MetadataFieldMapping, MappingExpression, FieldInfo } from "@shared/json-import";
import { createEmptyExpression } from "@shared/json-import";
import { cn } from "@/lib/utils";

interface MetadataFieldsEditorProps {
  value: MetadataFieldMapping[];
  onChange: (value: MetadataFieldMapping[]) => void;
  availableFields: FieldInfo[];
  disabled?: boolean;
}

export function MetadataFieldsEditor({
  value,
  onChange,
  availableFields,
  disabled = false,
}: MetadataFieldsEditorProps) {
  // Проверка дубликатов ключей
  const duplicateKeys = value
    .map(f => f.key.toLowerCase().trim())
    .filter((key, index, arr) => key && arr.indexOf(key) !== index);

  // Добавление нового поля
  const handleAddField = useCallback(() => {
    const newField: MetadataFieldMapping = {
      key: '',
      expression: createEmptyExpression(),
    };
    onChange([...value, newField]);
  }, [value, onChange]);

  // Удаление поля
  const handleRemoveField = useCallback((index: number) => {
    onChange(value.filter((_, i) => i !== index));
  }, [value, onChange]);

  // Изменение ключа
  const handleKeyChange = useCallback((index: number, newKey: string) => {
    const newValue = [...value];
    newValue[index] = { ...newValue[index], key: newKey };
    onChange(newValue);
  }, [value, onChange]);

  // Изменение выражения
  const handleExpressionChange = useCallback((index: number, expression: MappingExpression) => {
    const newValue = [...value];
    newValue[index] = { ...newValue[index], expression };
    onChange(newValue);
  }, [value, onChange]);

  return (
    <div className="space-y-3">
      {/* Ошибка дубликатов */}
      {duplicateKeys.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Найдены дубликаты ключей: {duplicateKeys.join(', ')}. 
            Имена полей метаданных должны быть уникальны.
          </AlertDescription>
        </Alert>
      )}

      {/* Список полей */}
      {value.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">
          Нет полей метаданных. Нажмите "Добавить поле" чтобы добавить.
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((field, index) => {
            const isDuplicate = duplicateKeys.includes(field.key.toLowerCase().trim());
            const isEmptyKey = !field.key.trim();

            return (
              <div
                key={index}
                className={cn(
                  "flex items-start gap-2 p-3 rounded-md border",
                  isDuplicate && "border-destructive bg-destructive/5",
                )}
              >
                {/* Drag handle (для будущего drag & drop) */}
                <div className="pt-2 cursor-move opacity-50 hover:opacity-100">
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Имя ключа */}
                <div className="w-40 flex-shrink-0">
                  <Label className="sr-only">Имя поля</Label>
                  <Input
                    value={field.key}
                    onChange={(e) => handleKeyChange(index, e.target.value)}
                    placeholder="Имя поля"
                    disabled={disabled}
                    className={cn(
                      "font-mono text-sm",
                      (isDuplicate || isEmptyKey) && "border-destructive",
                    )}
                  />
                  {isEmptyKey && (
                    <p className="text-xs text-destructive mt-1">Укажите имя</p>
                  )}
                </div>

                {/* Разделитель */}
                <div className="pt-2 text-muted-foreground">=</div>

                {/* Выражение */}
                <div className="flex-1">
                  <Label className="sr-only">Значение</Label>
                  <ExpressionInput
                    value={field.expression}
                    onChange={(expr) => handleExpressionChange(index, expr)}
                    availableFields={availableFields}
                    placeholder="Выберите поле или введите значение..."
                    disabled={disabled}
                  />
                </div>

                {/* Кнопка удаления */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveField(index)}
                  disabled={disabled}
                  className="flex-shrink-0"
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Кнопка добавления */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddField}
        disabled={disabled}
        className="w-full"
      >
        <Plus className="mr-2 h-4 w-4" />
        Добавить поле
      </Button>

      {/* Подсказка */}
      <p className="text-xs text-muted-foreground">
        Метаданные сохраняются как JSON-объект и доступны для поиска и фильтрации.
      </p>
    </div>
  );
}

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, CheckCircle2 } from "lucide-react";
import type { SchemaFieldConfig } from "@shared/knowledge-base-indexing";
import { COLLECTION_FIELD_TYPES } from "@shared/knowledge-base-indexing";
import { createFieldToken } from "@shared/json-import";
import { createRandomId } from "@/lib/knowledge-base";

interface SuggestedField {
  name: string;
  type: (typeof COLLECTION_FIELD_TYPES)[number];
  expression: SchemaFieldConfig["expression"];
  reason: string;
}

interface SuggestFieldsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadataKeys: string[];
  onAccept: (fields: SchemaFieldConfig[]) => void;
  existingFields: SchemaFieldConfig[];
}

/**
 * Определяет тип поля на основе имени и значения
 */
function inferFieldType(key: string): (typeof COLLECTION_FIELD_TYPES)[number] {
  const lowerKey = key.toLowerCase();
  
  // Проверяем по имени
  if (lowerKey.includes("date") || lowerKey.includes("time") || lowerKey.includes("created") || lowerKey.includes("updated")) {
    return "datetime";
  }
  if (lowerKey.includes("id") || lowerKey.includes("count") || lowerKey.includes("number") || lowerKey.includes("num")) {
    return "integer";
  }
  if (lowerKey.includes("price") || lowerKey.includes("amount") || lowerKey.includes("cost") || lowerKey.includes("rate")) {
    return "float";
  }
  if (lowerKey.includes("is_") || lowerKey.includes("has_") || lowerKey === "active" || lowerKey === "enabled") {
    return "boolean";
  }
  if (lowerKey.includes("category") || lowerKey.includes("tag") || lowerKey.includes("status") || lowerKey.includes("type")) {
    return "keyword";
  }
  
  // По умолчанию - text для длинных значений, keyword для коротких
  return "keyword";
}

export function SuggestFieldsDialog({
  open,
  onOpenChange,
  metadataKeys,
  onAccept,
  existingFields,
}: SuggestFieldsDialogProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Генерируем предложения полей на основе ключей метаданных
  const suggestedFields = useMemo<SuggestedField[]>(() => {
    const existingFieldNames = new Set(existingFields.map((f) => f.name));
    
    return metadataKeys
      .filter((key) => {
        // Исключаем уже существующие поля
        if (existingFieldNames.has(key)) {
          return false;
        }
        // Исключаем системные поля
        if (key === "text" || key.startsWith("_")) {
          return false;
        }
        return true;
      })
      .slice(0, 20) // Ограничиваем до 20 предложений
      .map((key) => ({
        name: key,
        type: inferFieldType(key),
        expression: [createFieldToken(`metadata.${key}`)],
        reason: "Найдено в метаданных документов",
      }));
  }, [metadataKeys, existingFields]);

  const handleToggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAccept = () => {
    const selectedFields: SchemaFieldConfig[] = suggestedFields
      .filter((field) => selectedKeys.has(field.name))
      .map((field) => ({
        id: createRandomId(),
        name: field.name,
        type: field.type,
        isArray: false,
        expression: field.expression,
        isEmbeddingField: false,
      }));

    onAccept(selectedFields);
    setSelectedKeys(new Set());
    onOpenChange(false);
  };

  const handleSelectAll = () => {
    setSelectedKeys(new Set(suggestedFields.map((f) => f.name)));
  };

  const handleDeselectAll = () => {
    setSelectedKeys(new Set());
  };

  if (suggestedFields.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подобрать поля автоматически</DialogTitle>
            <DialogDescription>
              Не найдено полей для предложения. Убедитесь, что в документах базы знаний есть метаданные.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Подобрать поля автоматически
          </DialogTitle>
          <DialogDescription>
            Выберите поля, которые будут добавлены в схему на основе метаданных документов базы знаний.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Найдено {suggestedFields.length} {suggestedFields.length === 1 ? "поле" : "полей"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                Выбрать все
              </Button>
              <Button variant="outline" size="sm" onClick={handleDeselectAll}>
                Снять выбор
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {suggestedFields.map((field) => (
              <Card key={field.name} className="cursor-pointer hover:border-primary transition-colors">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`suggest-${field.name}`}
                      checked={selectedKeys.has(field.name)}
                      onCheckedChange={() => handleToggleKey(field.name)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`suggest-${field.name}`} className="font-medium cursor-pointer">
                          {field.name}
                        </Label>
                        <Badge variant="outline" className="text-xs">
                          {field.type}
                        </Badge>
                      </div>
                      <CardDescription className="text-xs">{field.reason}</CardDescription>
                      <div className="text-xs font-mono text-muted-foreground">
                        {field.expression.map((token) => {
                          if (token.type === "field") {
                            return `{{${token.value}}}`;
                          }
                          return "";
                        }).join("")}
                      </div>
                    </div>
                    {selectedKeys.has(field.name) && (
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleAccept} disabled={selectedKeys.size === 0}>
            Добавить выбранные ({selectedKeys.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

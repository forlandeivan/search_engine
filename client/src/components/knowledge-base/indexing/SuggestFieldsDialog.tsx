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
import { Sparkles, CheckCircle2, Database, FileText } from "lucide-react";
import type { SchemaFieldConfig } from "@shared/knowledge-base-indexing";
import { createFieldToken } from "@shared/json-import";
import { createRandomId } from "@/lib/knowledge-base";

interface SuggestedField {
  name: string;
  expression: SchemaFieldConfig["expression"];
  description: string;
  category: "system" | "metadata";
}

interface SuggestFieldsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadataKeys: string[];
  onAccept: (fields: SchemaFieldConfig[]) => void;
  existingFields: SchemaFieldConfig[];
}

/**
 * Системные поля чанков, которые записываются в payload при индексации
 */
const SYSTEM_CHUNK_FIELDS: SuggestedField[] = [
  { name: "title", expression: [createFieldToken("title")], description: "Заголовок документа", category: "system" },
  { name: "document_url", expression: [createFieldToken("documentUrl")], description: "Ссылка на документ в системе", category: "system" },
  { name: "document_id", expression: [createFieldToken("documentId")], description: "ID документа", category: "system" },
  { name: "chunk_index", expression: [createFieldToken("chunk_index")], description: "Индекс чанка (0-based)", category: "system" },
  { name: "chunk_ordinal", expression: [createFieldToken("chunk_ordinal")], description: "Порядковый номер чанка (1-based)", category: "system" },
  { name: "version_id", expression: [createFieldToken("versionId")], description: "ID версии документа", category: "system" },
  { name: "version_number", expression: [createFieldToken("versionNumber")], description: "Номер версии", category: "system" },
  { name: "knowledge_base_id", expression: [createFieldToken("knowledgeBaseId")], description: "ID базы знаний", category: "system" },
  { name: "knowledge_base_name", expression: [createFieldToken("knowledgeBaseName")], description: "Название базы знаний", category: "system" },
];

export function SuggestFieldsDialog({
  open,
  onOpenChange,
  metadataKeys,
  onAccept,
  existingFields,
}: SuggestFieldsDialogProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Генерируем предложения полей на основе системных полей и метаданных
  const suggestedFields = useMemo<SuggestedField[]>(() => {
    const existingFieldNames = new Set(existingFields.map((f) => f.name));
    const allFields: SuggestedField[] = [];
    
    // Добавляем системные поля чанков
    for (const field of SYSTEM_CHUNK_FIELDS) {
      if (!existingFieldNames.has(field.name)) {
        allFields.push(field);
      }
    }
    
    // Добавляем поля из метаданных документов
    if (metadataKeys && Array.isArray(metadataKeys)) {
      for (const key of metadataKeys) {
        // Исключаем уже существующие поля
        if (existingFieldNames.has(key)) {
          continue;
        }
        // Исключаем системные поля
        if (key === "text" || key === "content" || key.startsWith("_")) {
          continue;
        }
        allFields.push({
          name: key,
          expression: [createFieldToken(`metadata.${key}`)],
          description: "Из метаданных документа",
          category: "metadata",
        });
      }
    }
    
    return allFields.slice(0, 30); // Ограничиваем до 30 предложений
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
        type: "keyword" as const,
        isArray: false,
        // Глубокая копия expression для избежания мутаций
        expression: field.expression.map(token => ({ ...token })),
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

  // Группируем поля по категориям
  const systemFields = useMemo(() => suggestedFields.filter(f => f.category === "system"), [suggestedFields]);
  const metadataFields = useMemo(() => suggestedFields.filter(f => f.category === "metadata"), [suggestedFields]);

  if (suggestedFields.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подобрать поля автоматически</DialogTitle>
            <DialogDescription>
              Не найдено полей для предложения. Все доступные поля уже добавлены в схему.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const renderFieldCard = (field: SuggestedField) => (
    <Card 
      key={field.name} 
      className="cursor-pointer hover:border-primary transition-colors"
      onClick={() => handleToggleKey(field.name)}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <Checkbox
            id={`suggest-${field.name}`}
            checked={selectedKeys.has(field.name)}
            onCheckedChange={() => handleToggleKey(field.name)}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Label htmlFor={`suggest-${field.name}`} className="font-medium cursor-pointer">
                {field.name}
              </Label>
              <span className="text-xs text-muted-foreground">— {field.description}</span>
            </div>
            <div className="text-xs font-mono text-muted-foreground mt-1">
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
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Подобрать поля автоматически
          </DialogTitle>
          <DialogDescription>
            Выберите поля, которые будут добавлены в схему индекса.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Найдено {suggestedFields.length} полей
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

          {/* Системные поля чанков */}
          {systemFields.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4" />
                Системные поля чанков
              </div>
              {systemFields.map(renderFieldCard)}
            </div>
          )}

          {/* Поля из метаданных документов */}
          {metadataFields.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                Метаданные документов
              </div>
              {metadataFields.map(renderFieldCard)}
            </div>
          )}
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

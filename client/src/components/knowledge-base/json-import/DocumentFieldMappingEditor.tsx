import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ExpressionInput } from "./ExpressionInput";
import { MetadataFieldsEditor } from "./MetadataFieldsEditor";
import { MappingPreview } from "./MappingPreview";
import type { 
  MappingConfigV2, 
  MappingExpression,
} from "@shared/json-import";
import { createFieldToken, createEmptyExpression } from "@shared/json-import";
import { isExpressionEmpty } from "@/lib/expression-utils";
import type { FieldInfo, StructureAnalysis } from "@/lib/json-import-types";

// Определение полей документа
const DOCUMENT_FIELDS = [
  { 
    key: 'id', 
    label: 'ID', 
    description: 'Уникальный идентификатор для дедупликации',
    required: false,
    hint: 'Если не указан — будет сгенерирован автоматически',
  },
  { 
    key: 'title', 
    label: 'Заголовок', 
    description: 'Заголовок документа',
    required: false,
    hint: 'Если не указан — будет взят из первой строки контента',
  },
  { 
    key: 'content', 
    label: 'Контент', 
    description: 'Основной текст документа',
    required: true,
    hint: 'Обязательное поле',
  },
  { 
    key: 'contentHtml', 
    label: 'Контент (HTML)', 
    description: 'HTML версия контента',
    required: false,
    hint: 'Опционально. Используется для сохранения форматирования',
  },
  { 
    key: 'contentMd', 
    label: 'Контент (Markdown)', 
    description: 'Markdown версия контента',
    required: false,
    hint: 'Опционально. Используется для сохранения форматирования',
  },
] as const;

interface DocumentFieldMappingEditorProps {
  analysis: StructureAnalysis;
  initialConfig?: MappingConfigV2;
  onConfigChange: (config: MappingConfigV2) => void;
  onValidationChange?: (isValid: boolean) => void;
  showValidationErrors?: boolean;
  workspaceId: string;
}

export function DocumentFieldMappingEditor({
  analysis,
  initialConfig,
  onConfigChange,
  onValidationChange,
  showValidationErrors = false,
  workspaceId,
}: DocumentFieldMappingEditorProps) {
  // Инициализация состояния
  const [config, setConfig] = useState<MappingConfigV2>(() => {
    if (initialConfig) return initialConfig;
    
    return {
      version: 2,
      title: { expression: createEmptyExpression() },
      content: { expression: createEmptyExpression(), required: true },
      metadata: [],
    };
  });

  // Валидация
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Проверка обязательного поля контента
    if (isExpressionEmpty(config.content.expression)) {
      errors.push('Поле "Контент" обязательно. Выберите поле из JSON.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }, [config]);

  // Уведомляем родителя о валидности
  useEffect(() => {
    onValidationChange?.(validation.valid);
  }, [validation.valid, onValidationChange]);

  // Обновление выражения для поля документа
  const handleFieldExpressionChange = (
    fieldKey: 'id' | 'title' | 'content' | 'contentHtml' | 'contentMd',
    expression: MappingExpression
  ) => {
    const newConfig = { ...config };
    
    if (fieldKey === 'id' || fieldKey === 'contentHtml' || fieldKey === 'contentMd') {
      // Опциональные поля
      if (isExpressionEmpty(expression)) {
        if (fieldKey === 'id') {
          delete newConfig.id;
        } else if (fieldKey === 'contentHtml') {
          delete newConfig.contentHtml;
        } else {
          delete newConfig.contentMd;
        }
      } else {
        newConfig[fieldKey] = { expression };
      }
    } else {
      // Обязательные поля (title, content)
      newConfig[fieldKey] = { 
        expression, 
        required: fieldKey === 'content' 
      };
    }

    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  // Обновление метаданных
  const handleMetadataChange = (metadata: typeof config.metadata) => {
    const newConfig = { ...config, metadata };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  // Автоматическое предложение маппинга
  const handleApplySuggestions = () => {
    const suggestions = suggestMappingV2(analysis.fields);
    setConfig(suggestions);
    onConfigChange(suggestions);
  };

  // Получение текущего выражения для поля
  const getFieldExpression = (fieldKey: string): MappingExpression => {
    switch (fieldKey) {
      case 'id': return config.id?.expression ?? createEmptyExpression();
      case 'title': return config.title.expression;
      case 'content': return config.content.expression;
      case 'contentHtml': return config.contentHtml?.expression ?? createEmptyExpression();
      case 'contentMd': return config.contentMd?.expression ?? createEmptyExpression();
      default: return createEmptyExpression();
    }
  };

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Настройка маппинга полей</h3>
          <p className="text-sm text-muted-foreground">
            Укажите, какие поля JSON соответствуют полям документа
          </p>
        </div>
        <Button type="button" variant="outline" onClick={handleApplySuggestions}>
          <Sparkles className="mr-2 h-4 w-4" />
          Автоматически
        </Button>
      </div>

      {/* Ошибки валидации */}
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

      {/* Основные поля документа */}
      <Card>
        <CardHeader>
          <CardTitle>Поля документа</CardTitle>
          <CardDescription>
            Для каждого поля укажите выражение. Кликните на поле ввода, чтобы выбрать поле JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {DOCUMENT_FIELDS.map((field) => (
            <div key={field.key} className="grid grid-cols-[200px_1fr] gap-4 items-start">
              <div className="pt-2">
                <Label className="flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-destructive">*</span>}
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {field.hint}
                </p>
              </div>
              <ExpressionInput
                value={getFieldExpression(field.key)}
                onChange={(expr) => handleFieldExpressionChange(field.key as any, expr)}
                availableFields={analysis.fields}
                placeholder={`Выберите поле для "${field.label}"...`}
                error={showValidationErrors && field.required && isExpressionEmpty(getFieldExpression(field.key))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Метаданные */}
      <Card>
        <CardHeader>
          <CardTitle>Метаданные</CardTitle>
          <CardDescription>
            Дополнительные поля, которые будут сохранены в метаданных документа
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MetadataFieldsEditor
            value={config.metadata}
            onChange={handleMetadataChange}
            availableFields={analysis.fields}
          />
        </CardContent>
      </Card>

      {/* Предпросмотр */}
      {analysis.sampleRecords.length > 0 && (
        <MappingPreview
          config={config}
          sampleRecord={analysis.sampleRecords[0]}
          workspaceId={workspaceId}
        />
      )}

      {/* Индикатор успешной настройки */}
      {validation.valid && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Маппинг настроен корректно. Можно переходить к следующему шагу.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Автоматическое предложение маппинга на основе имён полей
 */
function suggestMappingV2(fields: FieldInfo[]): MappingConfigV2 {
  const TITLE_PATTERNS = ['title', 'name', 'header', 'subject', 'heading', 'название', 'заголовок'];
  const CONTENT_PATTERNS = ['content', 'text', 'body', 'description', 'article', 'контент', 'текст'];
  const ID_PATTERNS = ['id', '_id', 'uuid', 'key', 'identifier'];

  const config: MappingConfigV2 = {
    version: 2,
    title: { expression: [] },
    content: { expression: [], required: true },
    metadata: [],
  };

  for (const field of fields) {
    const lowerName = field.key.toLowerCase();
    const lowerPath = field.path.toLowerCase();

    if (ID_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      if (!config.id) {
        config.id = { expression: [createFieldToken(field.path)] };
      }
    } else if (TITLE_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      if (config.title.expression.length === 0) {
        config.title = { expression: [createFieldToken(field.path)] };
      }
    } else if (CONTENT_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      if (config.content.expression.length === 0) {
        config.content = { expression: [createFieldToken(field.path)], required: true };
      }
    } else {
      // Остальные поля — в метаданные
      config.metadata.push({
        key: field.key,
        expression: [createFieldToken(field.path)],
      });
    }
  }

  return config;
}

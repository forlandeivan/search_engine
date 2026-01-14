import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CollectionSchemaFieldInput } from "@shared/vectorization";

const TEMPLATE_PATH_LIMIT = 400;
const TEMPLATE_SUGGESTION_LIMIT = 150;

function collectTemplatePaths(source: unknown, limit = TEMPLATE_PATH_LIMIT): string[] {
  if (!source || typeof source !== "object") {
    return [];
  }

  const paths = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string) => {
    if (paths.size >= limit) {
      return;
    }

    if (value && typeof value === "object") {
      const objectValue = value as object;
      if (visited.has(objectValue)) {
        return;
      }
      visited.add(objectValue);
    }

    if (path) {
      paths.add(path);
    }

    if (paths.size >= limit) {
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item, index) => {
        const nextPath = path ? `${path}[${index}]` : `[${index}]`;
        visit(item, nextPath);
      });
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        if (paths.size >= limit) {
          return;
        }
        const nextPath = path ? `${path}.${key}` : key;
        visit(child, nextPath);
      });
    }
  };

  visit(source, "");

  return Array.from(paths).sort((a, b) => a.localeCompare(b, "ru"));
}

interface CollectionSchemaFieldWithId extends CollectionSchemaFieldInput {
  id: string;
}

function generateFieldId(): string {
  return `field-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createSchemaField(partial?: Partial<Omit<CollectionSchemaFieldWithId, "id">>): CollectionSchemaFieldWithId {
  return {
    id: generateFieldId(),
    name: "",
    type: "string",
    isArray: false,
    template: "",
    ...partial,
  };
}

// Mock context для подсказок (можно расширить в будущем)
const MOCK_TEMPLATE_CONTEXT = {
  chunk: {
    id: "chunk-1",
    index: 0,
    position: 0,
    start: 0,
    end: 100,
    text: "Пример текста чанка",
    charCount: 100,
    wordCount: 10,
    tokenCount: 15,
    excerpt: "Пример текста...",
  },
  document: {
    id: "doc-1",
    title: "Пример документа",
    text: "Полный текст документа",
    html: "<p>HTML содержимое</p>",
    path: "knowledge://base-1/doc-1",
    sourceUrl: "https://example.com",
    updatedAt: new Date().toISOString(),
    charCount: 1000,
    wordCount: 100,
    excerpt: "Краткое описание...",
    totalChunks: 10,
    chunkSize: 800,
    chunkOverlap: 200,
  },
  base: {
    id: "base-1",
    name: "Пример базы знаний",
    description: "Описание базы",
  },
  version: {
    id: "version-1",
    number: 1,
    createdAt: new Date().toISOString(),
  },
  provider: {
    id: "openai",
    name: "OpenAI",
  },
  embedding: {
    model: "text-embedding-3-small",
    vectorSize: 1536,
    tokens: 15,
    id: "emb-1",
  },
};

interface CollectionSchemaEditorProps {
  value: CollectionSchemaFieldInput[];
  onChange: (value: CollectionSchemaFieldInput[]) => void;
  disabled?: boolean;
}

export function CollectionSchemaEditor({ value, onChange, disabled = false }: CollectionSchemaEditorProps) {
  const [fields, setFields] = useState<CollectionSchemaFieldWithId[]>(() => {
    return value.map((field) => createSchemaField(field));
  });
  const [activeSuggestionsFieldId, setActiveSuggestionsFieldId] = useState<string | null>(null);
  const templateFieldRefs = useRef<Record<string, HTMLTextAreaElement>>({});

  // Синхронизация value с fields при изменении value извне
  useEffect(() => {
    const currentFieldsWithoutId = fields.map(({ id, ...rest }) => rest);
    const valueString = JSON.stringify(value);
    const currentString = JSON.stringify(currentFieldsWithoutId);
    
    if (valueString !== currentString) {
      setFields(value.map((field) => createSchemaField(field)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const templatePaths = useMemo(() => collectTemplatePaths(MOCK_TEMPLATE_CONTEXT, TEMPLATE_PATH_LIMIT), []);
  const limitedTemplateVariableSuggestions = useMemo(
    () => templatePaths.slice(0, TEMPLATE_SUGGESTION_LIMIT),
    [templatePaths],
  );
  const hasMoreTemplateSuggestions = templatePaths.length > TEMPLATE_SUGGESTION_LIMIT;

  const handleAddField = useCallback(() => {
    const newField = createSchemaField();
    const updated = [...fields, newField];
    setFields(updated);
    onChange(updated.map(({ id, ...rest }) => rest));
  }, [fields, onChange]);

  const handleRemoveField = useCallback(
    (id: string) => {
      if (fields.length <= 1) {
        return;
      }
      const updated = fields.filter((field) => field.id !== id);
      setFields(updated);
      onChange(updated.map(({ id, ...rest }) => rest));
    },
    [fields, onChange],
  );

  const handleUpdateField = useCallback(
    (id: string, updates: Partial<CollectionSchemaFieldInput>) => {
      const updated = fields.map((field) => (field.id === id ? { ...field, ...updates } : field));
      setFields(updated);
      onChange(updated.map(({ id, ...rest }) => rest));
    },
    [fields, onChange],
  );

  const handleTemplateInputChange = useCallback(
    (fieldId: string, event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      handleUpdateField(fieldId, { template: value });
      templateFieldRefs.current[fieldId] = event.target;
    },
    [handleUpdateField],
  );

  const handleTemplateKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      setActiveSuggestionsFieldId(null);
    }
  }, []);

  const handleInsertTemplateVariable = useCallback(
    (fieldId: string, path: string) => {
      const textarea = templateFieldRefs.current[fieldId];
      if (!textarea) {
        return;
      }

      const { selectionStart, selectionEnd, value } = textarea;
      const start = selectionStart ?? value.length;
      const end = selectionEnd ?? start;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const trimmedBefore = before.trimEnd();
      const hasOpenBraces = trimmedBefore.endsWith("{{");
      const needsLeadingSpace = hasOpenBraces && before.slice(trimmedBefore.length).length === 0;
      const insertion = hasOpenBraces ? `${needsLeadingSpace ? " " : ""}${path} }}` : `{{ ${path} }}`;
      const nextValue = `${before}${insertion}${after}`;

      handleUpdateField(fieldId, { template: nextValue });
      setActiveSuggestionsFieldId(null);

      requestAnimationFrame(() => {
        textarea.focus();
        const caretPosition = before.length + insertion.length;
        textarea.setSelectionRange(caretPosition, caretPosition);
      });
    },
    [handleUpdateField],
  );

  const renderField = (field: CollectionSchemaFieldWithId, index: number) => {
    const suggestionsVisible = activeSuggestionsFieldId === field.id;

    return (
      <div key={field.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <label className="text-xs font-medium">Название поля</label>
              <Input
                value={field.name}
                placeholder={`Поле ${index + 1}`}
                disabled={disabled}
                onChange={(event) => handleUpdateField(field.id, { name: event.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Тип</label>
              <Select
                value={field.type}
                disabled={disabled}
                onValueChange={(value) =>
                  handleUpdateField(field.id, { type: value as CollectionSchemaFieldInput["type"] })
                }
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">Строка</SelectItem>
                  <SelectItem value="double">Число</SelectItem>
                  <SelectItem value="object">Объект</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5 sm:pt-0">
              <Checkbox
                id={`schema-field-array-${field.id}`}
                checked={field.isArray}
                disabled={disabled}
                onCheckedChange={(checked) => handleUpdateField(field.id, { isArray: Boolean(checked) })}
              />
              <label htmlFor={`schema-field-array-${field.id}`} className="text-xs">
                Массив
              </label>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || fields.length === 1}
            onClick={() => handleRemoveField(field.id)}
          >
            Удалить
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Liquid шаблон</label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              disabled={disabled}
              onClick={() => {
                setActiveSuggestionsFieldId(suggestionsVisible ? null : field.id);
              }}
            >
              {suggestionsVisible ? "Скрыть подсказки" : "Показать подсказки"}
            </Button>
          </div>
          <Textarea
            value={field.template}
            rows={4}
            disabled={disabled}
            onChange={(event) => handleTemplateInputChange(field.id, event)}
            onKeyDown={handleTemplateKeyDown}
            placeholder="Например, {{ chunk.text }}"
            ref={(el) => {
              if (el) {
                templateFieldRefs.current[field.id] = el;
              }
            }}
          />
          {suggestionsVisible && limitedTemplateVariableSuggestions.length > 0 && (
            <div className="rounded-md border bg-muted/60 p-3 text-xs">
              <div className="mb-2 font-medium">Подставьте значение:</div>
              <div className="flex flex-wrap gap-2">
                {limitedTemplateVariableSuggestions.map((path) => (
                  <Button
                    key={path}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleInsertTemplateVariable(field.id, path)}
                    className="text-xs"
                    disabled={disabled}
                  >
                    {path}
                  </Button>
                ))}
              </div>
              {hasMoreTemplateSuggestions && (
                <div className="mt-2 text-muted-foreground">
                  Показаны первые {TEMPLATE_SUGGESTION_LIMIT} вариантов.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Схема полей</h4>
          <p className="text-xs text-muted-foreground">
            Настройте поля, которые будут сохраняться в векторной базе для каждого чанка. Используйте Liquid шаблоны для динамических значений.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleAddField} disabled={disabled}>
          Добавить поле
        </Button>
      </div>
      <div className="space-y-3">
        {fields.map((field, index) => renderField(field, index))}
      </div>
    </div>
  );
}


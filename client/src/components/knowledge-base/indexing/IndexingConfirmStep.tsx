import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Database, Settings, FileText, AlertTriangle, Loader2 } from "lucide-react";
import type { IndexingWizardConfig } from "@shared/knowledge-base-indexing";
import { compileExpressionToTemplate } from "@/lib/expression-compiler";

interface IndexingConfirmStepProps {
  config: IndexingWizardConfig;
  baseInfo: {
    id: string;
    name: string;
    documentCount: number;
  };
  onSubmit: () => void;
  isSubmitting: boolean;
  /** Сохранять настройки в политику базы */
  saveToPolicy: boolean;
  onSaveToPolicyChange: (value: boolean) => void;
  /** Режим индексации */
  indexingMode?: "full" | "changed";
}

// Форматирование выражения для отображения
function formatExpressionForDisplay(expression: IndexingWizardConfig["schemaFields"][0]["expression"]): string {
  if (!expression || expression.length === 0) {
    return "[пусто]";
  }

  return expression
    .map((token) => {
      switch (token.type) {
        case "field":
          return `{{${token.value}}}`;
        case "function":
          const args = token.args?.join(", ") || "";
          return `[${token.value}(${args})]`;
        case "llm":
          return "[LLM генерация]";
        case "text":
          return token.value;
        default:
          return "";
      }
    })
    .join("");
}

// Проверка наличия LLM токенов
function hasLlmTokens(fields: IndexingWizardConfig["schemaFields"]): boolean {
  return fields.some((field) =>
    field.expression.some((token) => token.type === "llm"),
  );
}

export function IndexingConfirmStep({
  config,
  baseInfo,
  onSubmit,
  isSubmitting,
  saveToPolicy,
  onSaveToPolicyChange,
  indexingMode = "changed",
}: IndexingConfirmStepProps) {
  const hasLlm = useMemo(() => hasLlmTokens(config.schemaFields), [config.schemaFields]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Шаг 4: Подтверждение</h3>
        <p className="text-sm text-muted-foreground">Проверьте настройки перед запуском индексации.</p>
      </div>

      {/* Сводка */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Сводка
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">База знаний:</span>
            <span className="font-medium">{baseInfo.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Документов:</span>
            <span className="font-medium">{baseInfo.documentCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Режим:</span>
            <span className="font-medium">
              {indexingMode === "full" ? "Полная индексация" : "Индексация изменённых"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Параметры чанкования */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Параметры чанкования
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Размер чанка:</span>
            <span className="font-medium">{config.chunkSize} символов</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Перекрытие:</span>
            <span className="font-medium">{config.chunkOverlap} символов</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Примерно чанков:</span>
            <span className="font-medium">~{Math.ceil((10000 - config.chunkOverlap) / (config.chunkSize - config.chunkOverlap))} (при среднем размере документа)</span>
          </div>
        </CardContent>
      </Card>

      {/* Эмбеддинги */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Эмбеддинги
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Провайдер:</span>
            <span className="font-medium">{config.embeddingsProvider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Модель:</span>
            <span className="font-medium">{config.embeddingsModel}</span>
          </div>
        </CardContent>
      </Card>

      {/* Схема полей */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Схема полей ({config.schemaFields.length} {config.schemaFields.length === 1 ? "поле" : "полей"})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {config.schemaFields.map((field) => (
              <div key={field.id} className="flex items-start justify-between gap-4 py-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{field.name}</span>
                    <span className="text-muted-foreground">({field.type})</span>
                    {field.isEmbeddingField && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">векторизация</span>
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5 font-mono">
                    {formatExpressionForDisplay(field.expression)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Checkbox сохранения */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start space-x-2">
            <Checkbox
              id="save-to-policy"
              checked={saveToPolicy}
              onCheckedChange={(checked) => onSaveToPolicyChange(checked === true)}
              disabled={isSubmitting}
            />
            <div className="space-y-1 leading-none flex-1">
              <Label htmlFor="save-to-policy" className="text-sm font-medium cursor-pointer">
                Сохранить настройки для следующих индексаций
              </Label>
              <p className="text-xs text-muted-foreground">
                Эти настройки будут использоваться по умолчанию для данной базы знаний
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Предупреждения */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Индексация выполняется в фоновом режиме</li>
            {hasLlm && <li>Поля с LLM-генерацией увеличивают время обработки</li>}
            {baseInfo.documentCount > 100 && (
              <li>Индексация может занять продолжительное время ({baseInfo.documentCount} документов)</li>
            )}
            <li>Прогресс можно отслеживать на странице базы знаний</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}

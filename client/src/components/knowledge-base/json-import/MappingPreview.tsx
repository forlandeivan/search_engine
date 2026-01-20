import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { useLlmTestGeneration } from "@/hooks/useLlmTestGeneration";
import { hasLlmToken, getLlmToken, evaluateExpressionClient } from "@/lib/expression-utils";
import type { MappingConfigV2 } from "@shared/json-import";

interface MappingPreviewProps {
  config: MappingConfigV2;
  sampleRecord: Record<string, unknown>;
  workspaceId: string;
}

export function MappingPreview({ config, sampleRecord, workspaceId }: MappingPreviewProps) {
  const preview = useMemo(() => {
    return {
      id: config.id ? evaluateExpressionClient(config.id.expression, sampleRecord) : undefined,
      title: evaluateExpressionClient(config.title.expression, sampleRecord) || 'Без названия',
      content: evaluateExpressionClient(config.content.expression, sampleRecord) || '(пусто)',
      metadata: Object.fromEntries(
        config.metadata.map(m => [
          m.key,
          evaluateExpressionClient(m.expression, sampleRecord)
        ])
      ),
    };
  }, [config, sampleRecord]);

  // Проверяем, какие поля содержат LLM
  const llmFields = useMemo(() => ({
    title: hasLlmToken(config.title.expression),
    id: config.id ? hasLlmToken(config.id.expression) : false,
    content: hasLlmToken(config.content.expression),
  }), [config]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Предпросмотр документа</CardTitle>
        <CardDescription>
          Как будет выглядеть документ после маппинга (на основе первой записи)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview.id && (
          <PreviewField
            label="ID"
            value={preview.id}
            hasLlm={llmFields.id}
            expression={config.id?.expression}
            sampleRecord={sampleRecord}
            workspaceId={workspaceId}
          />
        )}
        
        <PreviewField
          label="Заголовок"
          value={preview.title}
          hasLlm={llmFields.title}
          expression={config.title.expression}
          sampleRecord={sampleRecord}
          workspaceId={workspaceId}
          isBold
        />
        
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-1">Контент</div>
          <div className="text-sm whitespace-pre-wrap max-h-48 overflow-auto border rounded p-2 break-words">
            {preview.content}
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
  );
}

// Компонент для отображения поля с возможностью тестовой генерации
interface PreviewFieldProps {
  label: string;
  value: string;
  hasLlm: boolean;
  expression?: import("@shared/json-import").MappingExpression;
  sampleRecord: Record<string, unknown>;
  workspaceId: string;
  isBold?: boolean;
}

function PreviewField({
  label,
  value,
  hasLlm,
  expression,
  sampleRecord,
  workspaceId,
  isBold = false,
}: PreviewFieldProps) {
  const [testResult, setTestResult] = useState<string | null>(null);
  const { generate, isLoading, error } = useLlmTestGeneration({ workspaceId });

  const handleTest = async () => {
    if (!expression) return;
    
    const llmToken = getLlmToken(expression);
    if (!llmToken?.llmConfig) return;

    const result = await generate(
      llmToken.llmConfig.prompt,
      sampleRecord,
      llmToken.llmConfig.temperature
    );
    
    if (result) {
      setTestResult(result);
    }
  };

  return (
    <div>
      <div className="text-sm font-medium text-muted-foreground mb-1">{label}</div>
      <div className="flex items-start gap-2">
        <div className={`text-sm ${isBold ? 'font-semibold' : ''} flex-1`}>
          {hasLlm ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-green-600">{value}</span>
              {testResult && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-green-600"
                    >
                      Результат ▼
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Результат генерации</div>
                      <div className="text-sm p-2 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
                        {testResult}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Это тестовый результат. Реальное значение будет сгенерировано при импорте.
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </span>
          ) : (
            value
          )}
        </div>
        
        {hasLlm && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleTest}
            disabled={isLoading}
            title="Протестировать AI генерацию"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            <span className="ml-1 text-xs">Тест</span>
          </Button>
        )}
      </div>
      
      {error && (
        <div className="flex items-center gap-1 mt-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}

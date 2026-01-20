import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MappingConfigV2 } from "@shared/json-import";
import { evaluateExpressionClient } from "@/lib/expression-utils";

interface MappingPreviewProps {
  config: MappingConfigV2;
  sampleRecord: Record<string, unknown>;
}

export function MappingPreview({ config, sampleRecord }: MappingPreviewProps) {
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
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">ID</div>
            <div className="text-sm font-mono">{preview.id}</div>
          </div>
        )}
        
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-1">Заголовок</div>
          <div className="text-sm font-semibold">{preview.title}</div>
        </div>
        
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

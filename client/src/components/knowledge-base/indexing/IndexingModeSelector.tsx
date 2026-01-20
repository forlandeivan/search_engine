import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Settings } from "lucide-react";
import type { IndexingWizardConfig } from "@shared/knowledge-base-indexing";

interface IndexingModeSelectorProps {
  config: IndexingWizardConfig;
  onExpressMode: () => void;
  onAdvancedMode: () => void;
  disabled?: boolean;
}

export function IndexingModeSelector({
  config,
  onExpressMode,
  onAdvancedMode,
  disabled,
}: IndexingModeSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Экспресс режим */}
      <Card className="cursor-pointer hover:border-primary transition-colors" onClick={onExpressMode}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle>Экспресс</CardTitle>
          </div>
          <CardDescription>Запустить с текущими настройками</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <div>• Размер чанка: {config.chunkSize}</div>
            <div>• Провайдер: {config.embeddingsProvider}</div>
            <div>• Модель: {config.embeddingsModel}</div>
            <div>• Полей в схеме: {config.schemaFields.length}</div>
          </div>
          <Button className="w-full" disabled={disabled}>
            Запустить
          </Button>
        </CardContent>
      </Card>

      {/* Расширенный режим */}
      <Card className="cursor-pointer hover:border-primary transition-colors" onClick={onAdvancedMode}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle>Расширенный</CardTitle>
          </div>
          <CardDescription>Настроить параметры чанкования, эмбеддингов и схемы полей</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Рекомендуется для тонкой настройки параметров индексации и создания кастомных полей в payload.
          </p>
          <Button className="w-full" variant="outline" disabled={disabled}>
            Настроить →
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

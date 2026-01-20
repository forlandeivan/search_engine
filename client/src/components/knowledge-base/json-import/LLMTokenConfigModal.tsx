import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Info } from "lucide-react";
import { ExpressionInput } from "./ExpressionInput";
import type { MappingExpression, LLMTokenConfig, FieldInfo } from "@shared/json-import";
import { LLM_TOKEN_DEFAULTS } from "@shared/json-import";
import { isExpressionEmpty } from "@/lib/expression-utils";

interface LLMTokenConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableFields: FieldInfo[];
  initialConfig?: LLMTokenConfig;
  onSave: (config: LLMTokenConfig) => void;
}

export function LLMTokenConfigModal({
  open,
  onOpenChange,
  availableFields,
  initialConfig,
  onSave,
}: LLMTokenConfigModalProps) {
  // Состояние промпта
  const [prompt, setPrompt] = useState<MappingExpression>(
    initialConfig?.prompt ?? []
  );
  
  // Состояние температуры
  const [temperature, setTemperature] = useState<number>(
    initialConfig?.temperature ?? LLM_TOKEN_DEFAULTS.temperature
  );

  // Сброс состояния при открытии/закрытии
  useEffect(() => {
    if (open) {
      setPrompt(initialConfig?.prompt ?? []);
      setTemperature(initialConfig?.temperature ?? LLM_TOKEN_DEFAULTS.temperature);
    }
  }, [open, initialConfig]);

  // Валидация
  const isValid = !isExpressionEmpty(prompt);

  // Сохранение
  const handleSave = useCallback(() => {
    if (!isValid) return;
    
    onSave({
      prompt,
      temperature,
    });
    onOpenChange(false);
  }, [prompt, temperature, isValid, onSave, onOpenChange]);

  // Отмена
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-green-600" />
            Настройка AI генерации
          </DialogTitle>
          <DialogDescription>
            Настройте промпт для генерации текста с помощью LLM модели.
            Используйте макросы для подстановки значений из полей документа.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Информация о модели */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Будет использована модель из системного навыка <strong>Unica Chat</strong>.
              Убедитесь, что навык настроен в админ-панели.
            </AlertDescription>
          </Alert>

          {/* Поле промпта */}
          <div className="space-y-2">
            <Label htmlFor="llm-prompt">
              Промпт <span className="text-destructive">*</span>
            </Label>
            <p className="text-sm text-muted-foreground">
              Введите текст промпта. Используйте макросы (Ctrl+Space) для вставки полей документа.
            </p>
            <ExpressionInput
              value={prompt}
              onChange={setPrompt}
              availableFields={availableFields}
              placeholder="Например: Придумай заголовок для текста: {{ content }}"
              error={!isValid && prompt.length > 0}
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              Пример: "Придумай краткий заголовок (до 10 слов) для следующего текста: {{ text }}"
            </p>
          </div>

          {/* Слайдер температуры */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="llm-temperature">Температура</Label>
              <span className="text-sm font-mono text-muted-foreground">
                {temperature.toFixed(1)}
              </span>
            </div>
            <Slider
              id="llm-temperature"
              min={0}
              max={1}
              step={0.1}
              value={[temperature]}
              onValueChange={([value]) => setTemperature(value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Низкая (0.0) — более предсказуемый результат. 
              Высокая (1.0) — более творческий.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            <Sparkles className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

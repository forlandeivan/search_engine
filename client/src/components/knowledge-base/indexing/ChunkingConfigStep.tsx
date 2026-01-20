import { useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, AlertTriangle } from "lucide-react";
import { MIN_CHUNK_SIZE, MAX_CHUNK_SIZE } from "@shared/indexing-rules";

interface ChunkingConfigStepProps {
  config: {
    chunkSize: number;
    chunkOverlap: number;
  };
  onChange: (config: { chunkSize: number; chunkOverlap: number }) => void;
  disabled?: boolean;
}

function estimateChunkCount(textLength: number, chunkSize: number, chunkOverlap: number): number {
  if (chunkSize <= chunkOverlap) return 0;
  const effectiveChunkSize = chunkSize - chunkOverlap;
  return Math.ceil((textLength - chunkOverlap) / effectiveChunkSize);
}

export function ChunkingConfigStep({ config, onChange, disabled }: ChunkingConfigStepProps) {
  const [chunkSize, setChunkSize] = useState(config.chunkSize);
  const [chunkOverlap, setChunkOverlap] = useState(config.chunkOverlap);
  const [chunkSizeError, setChunkSizeError] = useState<string | null>(null);
  const [chunkOverlapError, setChunkOverlapError] = useState<string | null>(null);

  // Синхронизация с внешним config
  useEffect(() => {
    setChunkSize(config.chunkSize);
    setChunkOverlap(config.chunkOverlap);
  }, [config.chunkSize, config.chunkOverlap]);

  // Валидация и обновление
  const updateChunkSize = (value: number) => {
    if (value < MIN_CHUNK_SIZE) {
      setChunkSizeError(`Минимальный размер чанка: ${MIN_CHUNK_SIZE}`);
      return;
    }
    if (value > MAX_CHUNK_SIZE) {
      setChunkSizeError(`Максимальный размер чанка: ${MAX_CHUNK_SIZE}`);
      return;
    }
    setChunkSizeError(null);
    const newChunkSize = Math.round(value);
    setChunkSize(newChunkSize);
    
    // Автоматически ограничиваем chunkOverlap
    if (chunkOverlap >= newChunkSize) {
      const newOverlap = Math.max(0, newChunkSize - 1);
      setChunkOverlap(newOverlap);
      onChange({ chunkSize: newChunkSize, chunkOverlap: newOverlap });
    } else {
      onChange({ chunkSize: newChunkSize, chunkOverlap });
    }
  };

  const updateChunkOverlap = (value: number) => {
    if (value < 0) {
      setChunkOverlapError("Перекрытие не может быть отрицательным");
      return;
    }
    if (value >= chunkSize) {
      setChunkOverlapError(`Перекрытие должно быть меньше размера чанка (${chunkSize})`);
      return;
    }
    setChunkOverlapError(null);
    const newOverlap = Math.round(value);
    setChunkOverlap(newOverlap);
    onChange({ chunkSize, chunkOverlap: newOverlap });
  };

  // Предварительный расчёт
  const exampleTextLength = 10000;
  const estimatedChunks = useMemo(
    () => estimateChunkCount(exampleTextLength, chunkSize, chunkOverlap),
    [chunkSize, chunkOverlap],
  );

  // Подсказки
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (chunkSize < 400) {
      w.push("Маленькие чанки могут терять контекст");
    }
    if (chunkSize > 2000) {
      w.push("Большие чанки могут снизить точность поиска");
    }
    if (chunkOverlap < 50) {
      w.push("Минимальное перекрытие может привести к потере контекста на границах");
    }
    if (chunkOverlap > chunkSize * 0.5) {
      w.push("Большое перекрытие увеличит количество чанков");
    }
    return w;
  }, [chunkSize, chunkOverlap]);

  const maxOverlap = Math.max(0, chunkSize - 1);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Шаг 1: Настройка чанкования</h3>
        <p className="text-sm text-muted-foreground">
          Размер чанка определяет, на какие фрагменты будут разбиты документы для векторного поиска.
        </p>
      </div>

      {/* Размер чанка */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Размер чанка (символов)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Slider
              value={[chunkSize]}
              onValueChange={([value]) => updateChunkSize(value)}
              min={MIN_CHUNK_SIZE}
              max={MAX_CHUNK_SIZE}
              step={100}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Мин: {MIN_CHUNK_SIZE}</span>
              <span className="font-medium">{chunkSize}</span>
              <span>Макс: {MAX_CHUNK_SIZE}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="chunk-size-input">Или введите значение вручную</Label>
            <Input
              id="chunk-size-input"
              type="number"
              min={MIN_CHUNK_SIZE}
              max={MAX_CHUNK_SIZE}
              step={100}
              value={chunkSize}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(value)) {
                  updateChunkSize(value);
                }
              }}
              disabled={disabled}
            />
            {chunkSizeError && (
              <p className="text-sm text-destructive">{chunkSizeError}</p>
            )}
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium">Рекомендации:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>400-600 — для коротких FAQ</li>
              <li>800-1200 — универсальный размер</li>
              <li>1500-2000 — для длинных документов</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Перекрытие чанков */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Перекрытие чанков (символов)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Slider
              value={[chunkOverlap]}
              onValueChange={([value]) => updateChunkOverlap(value)}
              min={0}
              max={maxOverlap}
              step={50}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Мин: 0</span>
              <span className="font-medium">{chunkOverlap}</span>
              <span>Макс: {maxOverlap}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="chunk-overlap-input">Или введите значение вручную</Label>
            <Input
              id="chunk-overlap-input"
              type="number"
              min={0}
              max={maxOverlap}
              step={50}
              value={chunkOverlap}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(value)) {
                  updateChunkOverlap(value);
                }
              }}
              disabled={disabled}
            />
            {chunkOverlapError && (
              <p className="text-sm text-destructive">{chunkOverlapError}</p>
            )}
          </div>
          <CardDescription>
            Перекрытие помогает сохранить контекст между чанками. Рекомендуется 10-25% от размера чанка.
          </CardDescription>
        </CardContent>
      </Card>

      {/* Предварительный расчёт */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            Предварительный расчёт
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            При текущих настройках документ из {exampleTextLength.toLocaleString()} символов будет разбит примерно на{" "}
            <strong>{estimatedChunks}</strong> чанков.
          </p>
        </CardContent>
      </Card>

      {/* Предупреждения */}
      {warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

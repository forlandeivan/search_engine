import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, HelpCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export interface SiteConfig {
  name: string;
  startUrls: string[];
  crawlDepth: number;
  maxChunkSize: number;
  chunkOverlap: boolean;
  chunkOverlapSize: number;
}

interface AddSiteFormProps {
  onSubmit: (config: SiteConfig) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = Math.round(DEFAULT_CHUNK_SIZE * 0.1);

export default function AddSiteForm({ onSubmit, onCancel, isSubmitting = false }: AddSiteFormProps) {
  const [projectName, setProjectName] = useState("");
  const [urls, setUrls] = useState<string[]>([""]);
  const [crawlDepth, setCrawlDepth] = useState<number>(3);
  const [maxChunkSize, setMaxChunkSize] = useState<number>(DEFAULT_CHUNK_SIZE);
  const [chunkOverlap, setChunkOverlap] = useState<boolean>(false);
  const [chunkOverlapSize, setChunkOverlapSize] = useState<number>(DEFAULT_CHUNK_OVERLAP);

  const updateUrl = (index: number, value: string) => {
    setUrls((prev) => prev.map((url, idx) => (idx === index ? value : url)));
  };

  const addUrlField = () => {
    setUrls((prev) => [...prev, ""]);
  };

  const removeUrlField = (index: number) => {
    setUrls((prev) => prev.filter((_, idx) => idx !== index));
  };

  const resetForm = () => {
    setProjectName("");
    setUrls([""]); 
    setCrawlDepth(3);
    setMaxChunkSize(DEFAULT_CHUNK_SIZE);
    setChunkOverlap(false);
    setChunkOverlapSize(DEFAULT_CHUNK_OVERLAP);
  };

  const handleCancel = () => {
    resetForm();
    onCancel?.();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = projectName.trim();
    const normalizedUrls = Array.from(
      new Set(
        urls
          .map((url) => url.trim())
          .filter((url) => url.length > 0)
      )
    );

    if (!trimmedName || normalizedUrls.length === 0) {
      return;
    }

    onSubmit({
      name: trimmedName,
      startUrls: normalizedUrls,
      crawlDepth,
      maxChunkSize,
      chunkOverlap,
      chunkOverlapSize: chunkOverlap ? chunkOverlapSize : 0,
    });
    resetForm();
  };

  const canRemoveUrl = urls.length > 1;
  const isSubmitDisabled =
    !projectName.trim() ||
    urls.every((url) => url.trim().length === 0) ||
    isSubmitting ||
    (chunkOverlap && chunkOverlapSize <= 0);

  const recommendedOverlap = Math.max(0, Math.round(maxChunkSize * 0.1));

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="form-add-project">
      <div className="space-y-2">
        <Label htmlFor="project-name">Название проекта</Label>
        <Input
          id="project-name"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="Например, Корпоративный блог"
          autoFocus
          data-testid="input-project-name"
          required
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Стартовые URL-адреса</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addUrlField}
            className="gap-1"
            data-testid="button-add-url"
          >
            <Plus className="h-4 w-4" />
            Добавить URL
          </Button>
        </div>

        <div className="space-y-2">
          {urls.map((url, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                type="url"
                value={url}
                onChange={(event) => updateUrl(index, event.target.value)}
                placeholder="https://example.com/section"
                data-testid={`input-project-url-${index}`}
                required={index === 0}
              />
              {canRemoveUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeUrlField(index)}
                  aria-label="Удалить URL"
                  data-testid={`button-remove-url-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Краулинг начнётся с каждой указанной страницы. Новые ссылки будут добавляться автоматически.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="crawl-depth">Глубина краулинга</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                  <p>1 уровень — только стартовые страницы.</p>
                  <p>2 уровня — стартовые страницы и ссылки с них.</p>
                  <p>3 уровня и выше — глубже по ссылкам внутри сайта.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Select
            value={crawlDepth.toString()}
            onValueChange={(value) => setCrawlDepth(parseInt(value, 10))}
          >
            <SelectTrigger id="crawl-depth" data-testid="select-crawl-depth">
              <SelectValue placeholder="Выберите глубину" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 уровень</SelectItem>
              <SelectItem value="2">2 уровня</SelectItem>
              <SelectItem value="3">3 уровня</SelectItem>
              <SelectItem value="5">5 уровней</SelectItem>
              <SelectItem value="10">10 уровней</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="chunk-size">Максимальный размер чанка (символы)</Label>
          <Input
            id="chunk-size"
            type="number"
            min={200}
            max={8000}
            step={100}
            value={maxChunkSize}
            onChange={(event) => setMaxChunkSize(Number(event.target.value))}
            data-testid="input-max-chunk-size"
            required
          />
          <p className="text-sm text-muted-foreground">
            Если текст длиннее указанного значения, он будет разбит на части 1/2, 2/2 и т.д.
          </p>
        </div>

        <div className="space-y-3 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="chunk-overlap-size">Перехлест чанков</Label>
              <p className="text-sm text-muted-foreground">
                Добавляет часть предыдущего чанка в следующий для сохранения контекста.
              </p>
            </div>
            <Switch
              id="chunk-overlap-toggle"
              checked={chunkOverlap}
              onCheckedChange={(checked) => {
                setChunkOverlap(checked);
                if (checked) {
                  setChunkOverlapSize((current) => {
                    if (current > 0) {
                      return Math.min(4000, maxChunkSize, current);
                    }
                    return Math.max(0, Math.min(4000, maxChunkSize, recommendedOverlap));
                  });
                }
              }}
              data-testid="switch-chunk-overlap"
            />
          </div>
          <div className="space-y-2 md:w-1/2">
            <Label htmlFor="chunk-overlap-size">Количество символов для перехлеста</Label>
            <Input
              id="chunk-overlap-size"
              type="number"
              min={0}
              max={4000}
              step={10}
              value={chunkOverlapSize}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isNaN(value)) {
                  setChunkOverlapSize(0);
                  return;
                }
                setChunkOverlapSize(Math.max(0, Math.min(4000, maxChunkSize, value)));
              }}
              disabled={!chunkOverlap}
              data-testid="input-chunk-overlap-size"
            />
            <p className="text-sm text-muted-foreground">
              Рекомендуемое значение — около 10% от размера чанка (≈{recommendedOverlap} символов).
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={handleCancel} data-testid="button-cancel" disabled={isSubmitting}>
            Отмена
          </Button>
        )}
        <Button type="submit" disabled={isSubmitDisabled} data-testid="button-add-site">
          {isSubmitting ? "Добавляем..." : "Добавить проект"}
        </Button>
      </div>
    </form>
  );
}

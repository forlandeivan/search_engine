import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, X } from "lucide-react";
import { projectTypeLabels, type ProjectType } from "@shared/schema";

const PROJECT_TYPE_OPTIONS: Array<{ value: ProjectType; label: string; description: string }> = [
  {
    value: "search_engine",
    label: projectTypeLabels.search_engine,
    description: "Классический краулер сайтов с полнотекстовым поиском и настройкой ранжирования.",
  },
  {
    value: "vector_search",
    label: projectTypeLabels.vector_search,
    description: "Проекты для семантического поиска по эмбеддингам. Настройка модели появится позже.",
  },
];

interface SiteConfig {
  url: string;
  projectType: ProjectType;
  crawlDepth: number;
  followExternalLinks: boolean;
  crawlFrequency: "manual" | "hourly" | "daily" | "weekly";
  excludePatterns: string[];
}

interface AddSiteFormProps {
  onSubmit: (config: SiteConfig) => void;
  onCancel?: () => void;
}

export default function AddSiteForm({ onSubmit, onCancel }: AddSiteFormProps) {
  const [config, setConfig] = useState<SiteConfig>({
    url: "",
    projectType: "search_engine",
    crawlDepth: 3,
    followExternalLinks: false,
    crawlFrequency: "daily",
    excludePatterns: []
  });
  
  const [newPattern, setNewPattern] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (config.url.trim()) {
      onSubmit({
        ...config,
        url: config.url.trim()
      });
      console.log('Site added:', config);
    }
  };

  const addExcludePattern = () => {
    if (newPattern.trim() && !config.excludePatterns.includes(newPattern.trim())) {
      setConfig(prev => ({
        ...prev,
        excludePatterns: [...prev.excludePatterns, newPattern.trim()]
      }));
      setNewPattern("");
    }
  };

  const removeExcludePattern = (pattern: string) => {
    setConfig(prev => ({
      ...prev,
      excludePatterns: prev.excludePatterns.filter(p => p !== pattern)
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Добавить сайт для краулинга</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="project-type">Тип проекта</Label>
            <Select
              value={config.projectType}
              onValueChange={(value) => setConfig(prev => ({ ...prev, projectType: value as ProjectType }))}
            >
              <SelectTrigger id="project-type" data-testid="select-project-type">
                <SelectValue placeholder="Выберите тип проекта" />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPE_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col text-left">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="url">URL сайта</Label>
            <Input
              id="url"
              type="url"
              value={config.url}
              onChange={(e) => setConfig(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://example.com"
              required
              data-testid="input-site-url"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="depth">Глубина краулинга</Label>
              <Select 
                value={config.crawlDepth.toString()} 
                onValueChange={(value) => setConfig(prev => ({ ...prev, crawlDepth: parseInt(value) }))}
              >
                <SelectTrigger data-testid="select-crawl-depth">
                  <SelectValue />
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

            <div>
              <Label htmlFor="frequency">Частота краулинга</Label>
              <Select 
                value={config.crawlFrequency} 
                onValueChange={(value: SiteConfig['crawlFrequency']) => 
                  setConfig(prev => ({ ...prev, crawlFrequency: value }))}
              >
                <SelectTrigger data-testid="select-crawl-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Вручную</SelectItem>
                  <SelectItem value="hourly">Каждый час</SelectItem>
                  <SelectItem value="daily">Каждый день</SelectItem>
                  <SelectItem value="weekly">Каждую неделю</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="external-links"
              checked={config.followExternalLinks}
              onCheckedChange={(checked) => 
                setConfig(prev => ({ ...prev, followExternalLinks: checked }))}
              data-testid="switch-external-links"
            />
            <Label htmlFor="external-links">Следовать внешним ссылкам</Label>
          </div>

          <div>
            <Label>Исключить пути (regex)</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="/admin|/private|\.pdf$"
                data-testid="input-exclude-pattern"
              />
              <Button 
                type="button" 
                onClick={addExcludePattern}
                disabled={!newPattern.trim()}
                data-testid="button-add-pattern"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {config.excludePatterns.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {config.excludePatterns.map((pattern, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-1 bg-muted rounded px-2 py-1 text-sm"
                  >
                    <code className="font-mono text-xs">{pattern}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeExcludePattern(pattern)}
                      className="h-4 w-4 p-0"
                      data-testid={`button-remove-pattern-${index}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button 
              type="submit" 
              disabled={!config.url.trim()}
              data-testid="button-add-site"
            >
              Добавить сайт
            </Button>
            {onCancel && (
              <Button 
                type="button" 
                variant="outline" 
                onClick={onCancel}
                data-testid="button-cancel"
              >
                Отмена
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export type { SiteConfig };
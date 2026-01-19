import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Folder, FolderTree, FileText, AlertTriangle } from "lucide-react";
import type { StructureAnalysis } from "@/lib/json-import-types";
import type { HierarchyConfig, EmptyValueStrategy } from "@shared/json-import";

interface HierarchyConfigEditorProps {
  analysis: StructureAnalysis;
  initialConfig?: HierarchyConfig;
  onConfigChange: (config: HierarchyConfig) => void;
}

interface HierarchyPreviewNode {
  name: string;
  type: "folder" | "document";
  documentCount?: number;
  children?: HierarchyPreviewNode[];
}

/**
 * Подсчитать документы по группам на основе примеров записей
 */
function calculateGroupDistribution(
  records: Array<Record<string, unknown>>,
  groupByField: string,
): Map<string, number> {
  const distribution = new Map<string, number>();

  for (const record of records) {
    // Получаем значение из вложенного объекта
    const parts = groupByField.split(".");
    let value: unknown = record;
    for (const part of parts) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }

    const groupValue = value ? String(value) : "";
    const count = distribution.get(groupValue) || 0;
    distribution.set(groupValue, count + 1);
  }

  return distribution;
}

/**
 * Построить предпросмотр структуры
 */
function buildHierarchyPreview(
  analysis: StructureAnalysis,
  config: HierarchyConfig,
): HierarchyPreviewNode[] {
  if (config.mode === "flat") {
    // Плоский список
    const rootNode: HierarchyPreviewNode = {
      name: config.rootFolderName || "Корень базы знаний",
      type: "folder",
      documentCount: analysis.estimatedRecordCount,
      children: [],
    };
    return [rootNode];
  }

  // Группировка
  if (!config.groupByField) {
    return [];
  }

  const distribution = calculateGroupDistribution(analysis.sampleRecords, config.groupByField);
  
  // Проверяем, есть ли поле в анализе и какая у него частота заполнения
  const fieldInfo = analysis.fields.find((f) => f.path === config.groupByField);
  const fieldFrequency = fieldInfo?.frequency ?? 0;
  const isFieldFullyPopulated = fieldFrequency === 100;
  
  // Подсчитываем общее количество документов в sampleRecords с непустыми значениями
  const sampleRecordsWithValue = analysis.sampleRecords.filter((record) => {
    const parts = config.groupByField.split(".");
    let value: unknown = record;
    for (const part of parts) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  
  const sampleRecordsWithValueCount = sampleRecordsWithValue.length;
  const sampleRecordsTotal = analysis.sampleRecords.length;
  const sampleRecordsEmptyCount = sampleRecordsTotal - sampleRecordsWithValueCount;
  
  // Экстраполируем на все записи
  const totalRecords = analysis.estimatedRecordCount;
  const recordsWithValueCount = isFieldFullyPopulated 
    ? totalRecords 
    : Math.round((sampleRecordsWithValueCount / sampleRecordsTotal) * totalRecords);
  const recordsEmptyCount = totalRecords - recordsWithValueCount;
  
  const sortedGroups = Array.from(distribution.entries())
    .filter(([value]) => value.trim() !== "") // Исключаем пустые значения
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20); // Показываем топ-20

  const children: HierarchyPreviewNode[] = [];

  // Папки по группам - экстраполируем количество на все записи
  const totalSampleCount = sortedGroups.reduce((sum, [, count]) => sum + count, 0);
  
  for (const [groupValue, sampleCount] of sortedGroups) {
    // Экстраполируем количество документов в этой папке пропорционально
    // Если поле заполнено у 100% записей, распределяем все записи пропорционально
    const extrapolatedCount = totalSampleCount > 0 && recordsWithValueCount > 0
      ? Math.round((sampleCount / totalSampleCount) * recordsWithValueCount)
      : sampleCount; // Fallback на sampleCount если что-то не так
    
    children.push({
      name: groupValue,
      type: "folder",
      documentCount: extrapolatedCount,
    });
  }

  // Обработка пустых значений
  if (recordsEmptyCount > 0) {
    if (config.emptyValueStrategy === "folder_uncategorized") {
      children.push({
        name: config.uncategorizedFolderName || "Без категории",
        type: "folder",
        documentCount: recordsEmptyCount,
      });
    } else if (config.emptyValueStrategy === "root") {
      // Документы в корне (не добавляем как папку, но учитываем в корне)
    }
    // skip - не добавляем и не учитываем
  }

  // В корне показываем только документы без значения (если emptyValueStrategy === "root")
  // или 0, если все документы распределены по папкам (поле заполнено у 100%)
  const rootDocumentCount = config.emptyValueStrategy === "root" 
    ? recordsEmptyCount 
    : 0;

  const rootNode: HierarchyPreviewNode = {
    name: config.rootFolderName || "Корень базы знаний",
    type: "folder",
    documentCount: rootDocumentCount,
    children,
  };

  return [rootNode];
}

export function HierarchyConfigEditor({
  analysis,
  initialConfig,
  onConfigChange,
}: HierarchyConfigEditorProps) {
  const [config, setConfig] = useState<HierarchyConfig>(
    initialConfig ?? {
      mode: "flat",
      emptyValueStrategy: "root",
      uncategorizedFolderName: "Без категории",
    },
  );

  const preview = useMemo(() => buildHierarchyPreview(analysis, config), [analysis, config]);

  const handleModeChange = (mode: "flat" | "grouped") => {
    const newConfig: HierarchyConfig = {
      ...config,
      mode,
      // При переключении на flat очищаем groupByField
      groupByField: mode === "grouped" ? config.groupByField : undefined,
    };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleGroupByFieldChange = (fieldPath: string) => {
    const newConfig: HierarchyConfig = {
      ...config,
      groupByField: fieldPath,
    };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleEmptyValueStrategyChange = (strategy: EmptyValueStrategy) => {
    const newConfig: HierarchyConfig = {
      ...config,
      emptyValueStrategy: strategy,
    };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleRootFolderNameChange = (name: string) => {
    const newConfig: HierarchyConfig = {
      ...config,
      rootFolderName: name.trim() || undefined,
    };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleUncategorizedFolderNameChange = (name: string) => {
    const newConfig: HierarchyConfig = {
      ...config,
      uncategorizedFolderName: name.trim() || "Без категории",
    };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  // Подсчитываем количество уникальных значений для выбранного поля
  const uniqueValuesCount = useMemo(() => {
    if (config.mode !== "grouped" || !config.groupByField) {
      return 0;
    }
    const distribution = calculateGroupDistribution(analysis.sampleRecords, config.groupByField);
    return distribution.size;
  }, [analysis.sampleRecords, config.mode, config.groupByField]);

  // Предупреждение о большом количестве папок
  const showManyFoldersWarning = uniqueValuesCount > 100;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Настройка структуры базы знаний</h3>
        <p className="text-sm text-muted-foreground">
          Выберите, как организовать документы в базе знаний
        </p>
      </div>

      {/* Выбор режима */}
      <Card>
        <CardHeader>
          <CardTitle>Режим организации</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={config.mode} onValueChange={handleModeChange}>
            <label
              className="flex cursor-pointer flex-col gap-2 rounded-md border p-4 transition hover:border-primary/40"
              style={{
                borderColor: config.mode === "flat" ? "hsl(var(--primary))" : undefined,
                backgroundColor: config.mode === "flat" ? "hsl(var(--primary) / 0.05)" : undefined,
              }}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="flat" id="mode-flat" />
                <span className="font-medium">Плоский список</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Все документы будут размещены в корне базы знаний (или в указанной родительской
                папке)
              </p>
            </label>

            <label
              className="flex cursor-pointer flex-col gap-2 rounded-md border p-4 transition hover:border-primary/40"
              style={{
                borderColor: config.mode === "grouped" ? "hsl(var(--primary))" : undefined,
                backgroundColor:
                  config.mode === "grouped" ? "hsl(var(--primary) / 0.05)" : undefined,
              }}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="grouped" id="mode-grouped" />
                <span className="font-medium">Группировка по полю</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Документы будут организованы в папки по значениям выбранного поля
              </p>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Настройки группировки */}
      {config.mode === "grouped" && (
        <Card>
          <CardHeader>
            <CardTitle>Настройки группировки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-by-field">Поле для группировки</Label>
              <Select
                value={config.groupByField || ""}
                onValueChange={handleGroupByFieldChange}
              >
                <SelectTrigger id="group-by-field">
                  <SelectValue placeholder="Выберите поле" />
                </SelectTrigger>
                <SelectContent>
                  {analysis.fields
                    .filter((f) => f.type !== "array" && f.type !== "object")
                    .map((field) => (
                      <SelectItem key={field.path} value={field.path}>
                        <div className="max-w-[300px]">
                          <div className="font-medium break-words">{field.key}</div>
                          <div className="text-xs text-muted-foreground break-all truncate">{field.path}</div>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {config.groupByField && (
              <>
                {showManyFoldersWarning && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Будет создано примерно {uniqueValuesCount} папок. Это может замедлить
                      импорт. Рекомендуется выбрать другое поле или использовать плоский список.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label>Записи без значения</Label>
                  <RadioGroup
                    value={config.emptyValueStrategy || "root"}
                    onValueChange={(value) =>
                      handleEmptyValueStrategyChange(value as EmptyValueStrategy)
                    }
                  >
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition hover:border-primary/40">
                      <RadioGroupItem
                        value="folder_uncategorized"
                        id="empty-strategy-folder"
                      />
                      <div className="flex-1">
                        <div className="font-medium">Поместить в папку</div>
                        <div className="text-sm text-muted-foreground">
                          Создать папку для записей без значения
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition hover:border-primary/40">
                      <RadioGroupItem value="root" id="empty-strategy-root" />
                      <div className="flex-1">
                        <div className="font-medium">Оставить в корне</div>
                        <div className="text-sm text-muted-foreground">
                          Разместить документы в корне базы знаний
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition hover:border-primary/40">
                      <RadioGroupItem value="skip" id="empty-strategy-skip" />
                      <div className="flex-1">
                        <div className="font-medium">Пропустить</div>
                        <div className="text-sm text-muted-foreground">
                          Не создавать документы для записей без значения
                        </div>
                      </div>
                    </label>
                  </RadioGroup>
                </div>

                {config.emptyValueStrategy === "folder_uncategorized" && (
                  <div className="space-y-2">
                    <Label htmlFor="uncategorized-folder-name">Название папки для пустых</Label>
                    <Input
                      id="uncategorized-folder-name"
                      value={config.uncategorizedFolderName || "Без категории"}
                      onChange={(e) => handleUncategorizedFolderNameChange(e.target.value)}
                      placeholder="Без категории"
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Родительская папка */}
      <Card>
        <CardHeader>
          <CardTitle>Родительская папка (опционально)</CardTitle>
          <CardDescription>
            Если указано, все документы и папки будут размещены внутри этой папки
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={config.rootFolderName || ""}
            onChange={(e) => handleRootFolderNameChange(e.target.value)}
            placeholder="Например: Импорт FAQ"
          />
        </CardContent>
      </Card>

      {/* Предпросмотр структуры */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderTree className="h-5 w-5" />
              Предпросмотр структуры
            </CardTitle>
            <CardDescription>
              Как будет организована база знаний после импорта
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {preview.map((node, idx) => (
                <HierarchyTree key={idx} node={node} level={0} />
              ))}
            </div>
            <div className="mt-4 text-sm text-muted-foreground">
              Всего: {analysis.estimatedRecordCount.toLocaleString()} документов
              {config.mode === "grouped" && config.groupByField && (
                <span>, {uniqueValuesCount} папок</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Компонент для отображения дерева иерархии
 */
function HierarchyTree({
  node,
  level,
}: {
  node: HierarchyPreviewNode;
  level: number;
}) {
  const indent = level * 20;

  return (
    <div style={{ marginLeft: `${indent}px` }} className="flex items-center gap-2 py-1">
      {node.type === "folder" ? (
        <Folder className="h-4 w-4 text-muted-foreground" />
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="text-sm break-words">
        {node.name}
        {node.documentCount !== undefined && (
          <Badge variant="secondary" className="ml-2">
            {node.documentCount.toLocaleString()} {node.documentCount === 1 ? "документ" : "документов"}
          </Badge>
        )}
      </span>
      {node.children && node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child, idx) => (
            <HierarchyTree key={idx} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

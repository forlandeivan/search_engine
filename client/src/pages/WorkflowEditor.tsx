import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Plus, Settings2, Trash2 } from "lucide-react";

type WorkflowStage = "ingest" | "transform" | "deliver";

interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  stage: WorkflowStage;
  isActive: boolean;
  config: Record<string, string>;
}

const stageMeta: Record<WorkflowStage, { label: string; description: string }> = {
  ingest: {
    label: "Сбор данных",
    description: "Коннекторы, которые наполняют базу контентом."
  },
  transform: {
    label: "Обработка",
    description: "Шаги нормализации, фильтрации и векторизации."
  },
  deliver: {
    label: "Доставка",
    description: "Выходные действия: отправка в индекс или внешние сервисы."
  }
};

function createStepId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
}

const defaultSteps: WorkflowStep[] = [
  {
    id: createStepId(),
    name: "Crawler",
    description: "Сканирование сайта и загрузка HTML-страниц",
    stage: "ingest",
    isActive: true,
    config: { depth: "2", delay: "1000" }
  },
  {
    id: createStepId(),
    name: "Vectorizer",
    description: "Подготовка чистого текста и преобразование в векторы",
    stage: "transform",
    isActive: true,
    config: { provider: "gigachat", chunkSize: "512" }
  },
  {
    id: createStepId(),
    name: "Sync to index",
    description: "Отправка данных в поисковый индекс",
    stage: "deliver",
    isActive: true,
    config: { mode: "append" }
  }
];

function getStageColor(stage: WorkflowStage) {
  switch (stage) {
    case "ingest":
      return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "transform":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400";
    case "deliver":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function WorkflowStepCard({
  step,
  isSelected,
  onSelect,
  onToggle,
}: {
  step: WorkflowStep;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (value: boolean) => void;
}) {
  return (
    <Card
      data-testid={`workflow-step-${step.id}`}
      className={cn(
        "transition-all border-dashed hover:border-solid", 
        isSelected && "border-primary bg-primary/5"
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base font-semibold leading-tight">{step.name}</CardTitle>
            <CardDescription>{step.description}</CardDescription>
          </div>
          <Switch
            checked={step.isActive}
            onCheckedChange={onToggle}
            onClick={(event) => event.stopPropagation()}
            aria-label={step.isActive ? "Отключить шаг" : "Включить шаг"}
          />
        </div>
        <Badge variant="outline" className={cn("w-fit text-xs", getStageColor(step.stage))}>
          {stageMeta[step.stage].label}
        </Badge>
      </CardHeader>
    </Card>
  );
}

export default function WorkflowEditor() {
  const [steps, setSteps] = useState<WorkflowStep[]>(defaultSteps);
  const [selectedStepId, setSelectedStepId] = useState<string>(defaultSteps[0]?.id ?? "");

  const selectedStep = useMemo(
    () => steps.find((step) => step.id === selectedStepId) ?? steps[0] ?? null,
    [steps, selectedStepId]
  );

  const activeStepsCount = useMemo(
    () => steps.filter((step) => step.isActive).length,
    [steps]
  );

  const handleAddStep = useCallback(() => {
    const newStep: WorkflowStep = {
      id: createStepId(),
      name: "Новый шаг",
      description: "Опишите назначение шага",
      stage: "ingest",
      isActive: false,
      config: {}
    };

    setSteps((previous) => [...previous, newStep]);
    setSelectedStepId(newStep.id);
  }, []);

  const handleRemoveStep = useCallback((stepId: string) => {
    setSteps((previous) => {
      if (previous.length === 1) {
        return previous;
      }

      const updated = previous.filter((step) => step.id !== stepId);
      if (!updated.some((step) => step.id === selectedStepId)) {
        setSelectedStepId(updated[0]?.id ?? "");
      }

      return updated;
    });
  }, [selectedStepId]);

  const handleToggleStep = useCallback((stepId: string, value: boolean) => {
    setSteps((previous) =>
      previous.map((step) => (step.id === stepId ? { ...step, isActive: value } : step))
    );
  }, []);

  const handleUpdateStep = useCallback(
    (stepId: string, partial: Partial<Omit<WorkflowStep, "id">>) => {
      setSteps((previous) =>
        previous.map((step) =>
          step.id === stepId
            ? {
                ...step,
                ...partial,
                config: partial.config ? { ...step.config, ...partial.config } : step.config,
              }
            : step
        )
      );
    },
    []
  );

  const renderConfigFields = (step: WorkflowStep) => {
    if (!Object.keys(step.config).length) {
      return (
        <p className="text-sm text-muted-foreground">
          Нет дополнительных параметров. Заполните форму или добавьте ключ вручную.
        </p>
      );
    }

    return (
      <div className="grid gap-3">
        {Object.entries(step.config).map(([key, value]) => (
          <div key={key} className="grid gap-1">
            <label className="text-sm font-medium" htmlFor={`config-${step.id}-${key}`}>
              {key}
            </label>
            <Input
              id={`config-${step.id}-${key}`}
              value={value}
              onChange={(event) =>
                handleUpdateStep(step.id, {
                  config: {
                    [key]: event.target.value,
                  },
                })
              }
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Конструктор workflow</h1>
          <p className="text-sm text-muted-foreground">
            Соберите последовательность шагов обработки данных для вашего проекта.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">Шагов: {steps.length}</Badge>
          <Badge variant="outline">Активных: {activeStepsCount}</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Шаги</h2>
            <Button size="sm" onClick={handleAddStep} data-testid="workflow-add-step">
              <Plus className="mr-2 h-4 w-4" />
              Добавить шаг
            </Button>
          </div>

          <ScrollArea className="h-[480px] pr-2">
            <div className="grid gap-3">
              {steps.map((step) => (
                <WorkflowStepCard
                  key={step.id}
                  step={step}
                  isSelected={step.id === (selectedStep?.id ?? "")}
                  onSelect={() => setSelectedStepId(step.id)}
                  onToggle={(value) => handleToggleStep(step.id, value)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        <Card className="min-h-[520px]">
          <CardHeader className="border-b bg-muted/40">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-lg">{selectedStep?.name ?? "Выберите шаг"}</CardTitle>
                <CardDescription>
                  {selectedStep ? stageMeta[selectedStep.stage].description : ""}
                </CardDescription>
              </div>
              {selectedStep && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => handleRemoveStep(selectedStep.id)}
                  disabled={steps.length === 1}
                  data-testid="workflow-remove-step"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {selectedStep ? (
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <label className="text-sm font-medium" htmlFor="workflow-step-name">
                      Название
                    </label>
                    <Input
                      id="workflow-step-name"
                      value={selectedStep.name}
                      onChange={(event) =>
                        handleUpdateStep(selectedStep.id, { name: event.target.value })
                      }
                    />
                  </div>

                  <div className="grid gap-1">
                    <label className="text-sm font-medium" htmlFor="workflow-step-description">
                      Описание
                    </label>
                    <Textarea
                      id="workflow-step-description"
                      value={selectedStep.description}
                      onChange={(event) =>
                        handleUpdateStep(selectedStep.id, { description: event.target.value })
                      }
                      rows={4}
                    />
                  </div>

                  <div className="grid gap-1">
                    <span className="text-sm font-medium">Этап</span>
                    <Tabs
                      value={selectedStep.stage}
                      onValueChange={(value) =>
                        handleUpdateStep(selectedStep.id, { stage: value as WorkflowStage })
                      }
                    >
                      <TabsList className="grid grid-cols-3">
                        {Object.entries(stageMeta).map(([value, meta]) => (
                          <TabsTrigger key={value} value={value} className="flex flex-col gap-1">
                            <span>{meta.label}</span>
                            <span className="text-[11px] font-normal text-muted-foreground">
                              {meta.description}
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3 text-sm">
                    <div>
                      <p className="font-medium">Статус</p>
                      <p className="text-muted-foreground">{selectedStep.isActive ? "Шаг активен" : "Шаг отключён"}</p>
                    </div>
                    <Switch
                      checked={selectedStep.isActive}
                      onCheckedChange={(value) => handleToggleStep(selectedStep.id, value)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Параметры шага</p>
                      <p className="text-xs text-muted-foreground">
                        Настройте индивидуальные параметры. Можно добавить новые ключи вручную.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleUpdateStep(selectedStep.id, {
                          config: { [`param_${Object.keys(selectedStep.config).length + 1}`]: "" },
                        })
                      }
                    >
                      <Settings2 className="mr-2 h-4 w-4" />
                      Добавить параметр
                    </Button>
                  </div>
                  {renderConfigFields(selectedStep)}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Выберите шаг из списка слева или создайте новый
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

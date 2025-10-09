import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  createKnowledgeBaseEntry,
  KnowledgeBase,
  KnowledgeBaseSourceType,
  readKnowledgeBaseStorage,
  writeKnowledgeBaseStorage,
  KNOWLEDGE_BASE_EVENT,
  getKnowledgeBaseSourceLabel,
} from "@/lib/knowledge-base";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Brain,
  FolderArchive,
  Globe,
  LayoutDashboard,
  NotebookPen,
  Plus,
} from "lucide-react";

const CREATION_OPTIONS: Array<{
  value: KnowledgeBaseSourceType;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    value: "blank",
    title: "Пустая база",
    description: "Создайте структуру с нуля и наполняйте контент вручную или с помощью AI.",
    icon: NotebookPen,
  },
  {
    value: "archive",
    title: "Импорт архива",
    description: "Загрузите ZIP-архив документов, чтобы автоматически разложить их в иерархию.",
    icon: FolderArchive,
  },
  {
    value: "crawler",
    title: "Краулинг сайта",
    description: "Подключите корпоративный портал или знания из публичного сайта для автообновления.",
    icon: Globe,
  },
];

const getKnowledgeBasesFromStorage = () => readKnowledgeBaseStorage().knowledgeBases;

const formatRelativeDate = (value?: string | null) => {
  if (!value) {
    return "Нет данных";
  }

  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ru });
  } catch (error) {
    return "Недавно";
  }
};

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>(() => getKnowledgeBasesFromStorage());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<KnowledgeBaseSourceType>("blank");
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseDescription, setNewBaseDescription] = useState("");
  const [archiveFileName, setArchiveFileName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [creationError, setCreationError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sync = () => {
      setKnowledgeBases(getKnowledgeBasesFromStorage());
    };

    window.addEventListener(KNOWLEDGE_BASE_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(KNOWLEDGE_BASE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const orderedBases = useMemo(
    () =>
      [...knowledgeBases].sort((a, b) => {
        const aDate = a.updatedAt || a.createdAt || "";
        const bDate = b.updatedAt || b.createdAt || "";
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      }),
    [knowledgeBases]
  );

  const totals = useMemo(() => {
    const baseTotal = knowledgeBases.length;
    const documents = knowledgeBases.reduce(
      (acc, base) => acc + Object.keys(base.documents ?? {}).length,
      0
    );
    const tasks = knowledgeBases.reduce(
      (acc, base) => acc + (base.tasks?.total ?? 0),
      0
    );

    return { baseTotal, documents, tasks };
  }, [knowledgeBases]);

  const resetDialog = () => {
    setCreationError(null);
    setNewBaseName("");
    setNewBaseDescription("");
    setArchiveFileName("");
    setSourceUrl("");
    setCreationMode("blank");
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
  };

  const handleOpenDialog = (mode: KnowledgeBaseSourceType) => {
    setCreationMode(mode);
    setCreationError(null);
    setIsDialogOpen(true);
  };

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setArchiveFileName(file.name);
    } else {
      setArchiveFileName("");
    }
  };

  const handleCreateBase = () => {
    if (!newBaseName.trim()) {
      setCreationError("Укажите название базы знаний");
      return;
    }

    if (creationMode === "archive" && !archiveFileName) {
      setCreationError("Выберите архив документов для импорта");
      return;
    }

    if (creationMode === "crawler" && !sourceUrl.trim()) {
      setCreationError("Укажите ссылку на сайт для краулинга");
      return;
    }

    const ingestion =
      creationMode === "archive"
        ? { type: "archive" as const, archiveName: archiveFileName }
        : creationMode === "crawler"
          ? { type: "crawler" as const, seedUrl: sourceUrl.trim() }
          : undefined;

    const base = createKnowledgeBaseEntry({
      name: newBaseName,
      description: newBaseDescription,
      sourceType: creationMode,
      ingestion,
    });

    const currentState = readKnowledgeBaseStorage();
    const updatedState = {
      knowledgeBases: [...currentState.knowledgeBases, base],
      selectedBaseId: base.id,
      selectedDocument: null,
    };

    writeKnowledgeBaseStorage(updatedState);
    setKnowledgeBases(updatedState.knowledgeBases);
    setIsDialogOpen(false);
    setLocation(`/knowledge/${base.id}`);
    resetDialog();
  };

  return (
    <div className="flex h-full flex-col gap-6 px-5 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <LayoutDashboard className="h-5 w-5" />
            Домашняя страница рабочего пространства
          </div>
          <h1 className="text-3xl font-semibold">AI KMS Дашборд</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Управляйте корпоративными знаниями, создавайте базы, назначайте задания команде и отслеживайте актуальность
            контента в пределах рабочего пространства.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary" className="px-3 py-1 text-xs">
              Баз знаний: {totals.baseTotal}
            </Badge>
            <Badge variant="outline" className="px-3 py-1 text-xs">
              Документов: {totals.documents}
            </Badge>
            <Badge variant="outline" className="px-3 py-1 text-xs">
              Заданий: {totals.tasks}
            </Badge>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={() => handleOpenDialog("blank")}>
            <Plus className="mr-2 h-4 w-4" />
            Новая база знаний
          </Button>
          <Button variant="outline" onClick={() => handleOpenDialog("archive")}>
            <FolderArchive className="mr-2 h-4 w-4" />
            Импорт архива
          </Button>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Быстрые сценарии создания
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {CREATION_OPTIONS.map((option) => (
            <Card key={option.value} className="transition hover:-translate-y-1 hover:shadow-md">
              <button
                type="button"
                onClick={() => handleOpenDialog(option.value)}
                className="flex h-full flex-col items-start gap-3 rounded-lg p-5 text-left"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <option.icon className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">{option.title}</h3>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
              </button>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ваши базы знаний
          </h2>
          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog("crawler")}>
            <Globe className="mr-2 h-4 w-4" />
            Настроить краулинг сайта
          </Button>
        </div>
        {orderedBases.length === 0 ? (
          <Card>
            <CardHeader className="flex flex-col items-center gap-3 text-center">
              <Brain className="h-12 w-12 text-muted-foreground" />
              <CardTitle>В этом рабочем пространстве нет баз знаний</CardTitle>
              <CardDescription>
                Создайте базу, импортируйте документы или подключите автоматический сбор, чтобы построить AI KMS.
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center pb-6">
              <Button onClick={() => handleOpenDialog("blank")}>Создать первую базу знаний</Button>
            </CardFooter>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {orderedBases.map((base) => {
              const documentCount = Object.keys(base.documents ?? {}).length;
              const tasks = base.tasks ?? { total: 0, inProgress: 0, completed: 0 };
              const lastActivity = base.updatedAt || base.createdAt || null;

              return (
                <Card key={base.id} className="flex h-full flex-col">
                  <CardHeader className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-lg font-semibold">{base.name}</CardTitle>
                      <Badge variant="outline" className="border-dashed text-xs uppercase tracking-wide">
                        {getKnowledgeBaseSourceLabel(base.sourceType)}
                      </Badge>
                    </div>
                    {base.description && (
                      <CardDescription className="line-clamp-3 text-sm">{base.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Документов</p>
                        <p className="text-lg font-semibold">{documentCount}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Заданий всего</p>
                        <p className="text-lg font-semibold">{tasks.total}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">В работе</p>
                        <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">{tasks.inProgress}</p>
                      </div>
                      <div className="rounded-lg border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Завершено</p>
                        <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                          {tasks.completed}
                        </p>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>Последняя активность: {formatRelativeDate(lastActivity)}</span>
                      <span>Последнее открытие: {formatRelativeDate(base.lastOpenedAt)}</span>
                      {base.ingestion?.seedUrl && <span>Источник: {base.ingestion.seedUrl}</span>}
                      {base.ingestion?.archiveName && <span>Архив: {base.ingestion.archiveName}</span>}
                    </div>
                  </CardContent>
                  <CardFooter className="flex items-center justify-between">
                    <Button size="sm" onClick={() => setLocation(`/knowledge/${base.id}`)}>
                      Открыть базу
                    </Button>
                    <Button size="sm" variant="outline" disabled>
                      Задание (скоро)
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            resetDialog();
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Создание базы знаний</DialogTitle>
            <DialogDescription>
              Выберите подходящий сценарий, задайте название и при необходимости укажите источники данных.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-2 sm:grid-cols-3">
              {CREATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCreationMode(option.value)}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3 text-left transition",
                    creationMode === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <option.icon className="h-4 w-4" />
                    <span className="text-sm font-semibold">{option.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="dashboard-base-name">
                Название базы знаний
              </label>
              <Input
                id="dashboard-base-name"
                placeholder="Например, База знаний по клиентской поддержке"
                value={newBaseName}
                onChange={(event) => setNewBaseName(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="dashboard-base-description">
                Краткое описание
              </label>
              <Textarea
                id="dashboard-base-description"
                rows={3}
                placeholder="Расскажите, для чего нужна база знаний и какие процессы она покрывает"
                value={newBaseDescription}
                onChange={(event) => setNewBaseDescription(event.target.value)}
              />
            </div>

            {creationMode === "archive" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">ZIP-архив документов</label>
                <input
                  ref={archiveInputRef}
                  type="file"
                  accept=".zip,.rar,.7z"
                  className="hidden"
                  onChange={handleArchiveChange}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => archiveInputRef.current?.click()}>
                    Выбрать архив
                  </Button>
                  {archiveFileName ? (
                    <span className="text-xs text-muted-foreground">Выбрано: {archiveFileName}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Поддерживаются ZIP, RAR и 7z архивы
                    </span>
                  )}
                </div>
              </div>
            )}

            {creationMode === "crawler" && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="dashboard-crawler-url">
                  Ссылка для краулинга
                </label>
                <Input
                  id="dashboard-crawler-url"
                  placeholder="https://docs.company.ru"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Мы обойдем вложенные страницы, создадим документы и будем отслеживать обновления автоматически.
                </p>
              </div>
            )}

            {creationError && <p className="text-sm text-destructive">{creationError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleCreateBase}>Создать базу знаний</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

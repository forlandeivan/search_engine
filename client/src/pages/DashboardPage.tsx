import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Separator } from "@/components/ui/separator";
import {
  KnowledgeBase,
  KnowledgeBaseSourceType,
  readKnowledgeBaseStorage,
  KNOWLEDGE_BASE_EVENT,
  getKnowledgeBaseSourceLabel,
  clearLegacyKnowledgeBaseStorageOnce,
} from "@/lib/knowledge-base";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Brain, LayoutDashboard } from "lucide-react";
import {
  CreateKnowledgeBaseDialog,
  KNOWLEDGE_BASE_CREATION_OPTIONS,
} from "@/components/knowledge-base/CreateKnowledgeBaseDialog";
import type { SessionResponse } from "@/types/session";

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
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>(() => getKnowledgeBasesFromStorage());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<KnowledgeBaseSourceType>("blank");
  const { data: session } = useQuery<SessionResponse>({ queryKey: ["/api/auth/session"] });
  // Безопасный доступ к workspaceId с проверкой всех уровней
  const workspaceId = session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;

  useEffect(() => {
    const cleared = clearLegacyKnowledgeBaseStorageOnce();
    if (cleared) {
      setKnowledgeBases([]);
    }
  }, []);

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

  const handleOpenDialog = (mode: KnowledgeBaseSourceType) => {
    setCreationMode(mode);
    setIsDialogOpen(true);
  };
  const handleBaseCreated = (base: KnowledgeBase) => {
    setKnowledgeBases(getKnowledgeBasesFromStorage());
    setLocation(`/knowledge/${base.id}`);
  };

  return (
    <div className="flex h-full flex-col gap-6 px-5 py-6">
      <header className="flex flex-wrap items-start gap-4">
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
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Быстрые сценарии создания
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {KNOWLEDGE_BASE_CREATION_OPTIONS.map((option) => (
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ваши базы знаний
        </h2>
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

      <CreateKnowledgeBaseDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        initialMode={creationMode}
        workspaceId={workspaceId}
        onCreated={handleBaseCreated}
      />
    </div>
  );
}

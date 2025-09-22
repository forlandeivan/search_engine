import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import CrawlStatusCard, { type CrawlStatus } from "@/components/CrawlStatusCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { projectTypeLabels, type InsertSite, type ProjectType, type Site } from "@shared/schema";

interface ProjectWithStats extends Site {
  pagesFound?: number;
  pagesIndexed?: number;
  progress?: number;
}

interface ProjectForDeletion {
  id: string;
  name: string;
}

interface VectorProjectCardProps {
  id: string;
  name: string;
  description?: string | null;
  href: string;
  onDelete: () => void;
}

export default function AdminPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchFilter, setSearchFilter] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("search_engine");
  const [projectToDelete, setProjectToDelete] = useState<ProjectForDeletion | null>(null);

  const {
    data: projects = [],
    isLoading,
    error,
  } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/sites/extended"],
  });

  const createProjectMutation = useMutation({
    mutationFn: async (
      payload: Pick<InsertSite, "name" | "description" | "projectType">,
    ) => {
      const response = await apiRequest("POST", "/api/sites", payload);
      return response.json();
    },
    onSuccess: (created: Site) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sites/extended"] });
      setIsCreateDialogOpen(false);
      setProjectName("");
      setProjectDescription("");
      setProjectType("search_engine");
      toast({
        title: "Проект создан",
        description: "Добавьте знания и настройте краулинг в карточке проекта.",
      });
      navigate(`/admin/sites/${created.id}`);
    },
    onError: (mutationError: unknown) => {
      console.error("Failed to create project", mutationError);
      toast({
        title: "Не удалось создать проект",
        description: "Проверьте подключение и попробуйте ещё раз.",
        variant: "destructive",
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await apiRequest("DELETE", `/api/sites/${projectId}`);
      if (response.status === 204) {
        return null;
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sites/extended"] });
      setProjectToDelete(null);
      toast({
        title: "Проект удалён",
        description: "Карточка проекта и связанные страницы удалены.",
      });
    },
    onError: (mutationError: unknown) => {
      console.error("Failed to delete project", mutationError);
      toast({
        title: "Не удалось удалить проект",
        description: "Повторите попытку позже.",
        variant: "destructive",
      });
    },
  });

  const startCrawlMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await apiRequest("POST", `/api/sites/${projectId}/crawl`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sites/extended"] });
      toast({
        title: "Краулинг запущен",
        description: "Проект поставлен в очередь на обход страниц.",
      });
    },
    onError: (mutationError: unknown) => {
      console.error("Failed to start crawl", mutationError);
      toast({
        title: "Не удалось запустить краулинг",
        description: "Проверьте настройки проекта и наличие URL.",
        variant: "destructive",
      });
    },
  });

  const recrawlMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await apiRequest("POST", `/api/sites/${projectId}/recrawl`);
      return response.json();
    },
    onSuccess: (data: { existingPages: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sites/extended"] });
      toast({
        title: "Повторный краулинг запущен",
        description: `Найдено страниц до запуска: ${data.existingPages}`,
      });
    },
    onError: (mutationError: unknown) => {
      console.error("Failed to recrawl", mutationError);
      toast({
        title: "Не удалось перезапустить краулинг",
        description: "Попробуйте обновить настройки проекта.",
        variant: "destructive",
      });
    },
  });

  const normalizedProjects = useMemo(
    () => (Array.isArray(projects) ? projects : []),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    const query = searchFilter.trim().toLowerCase();
    if (!query) {
      return normalizedProjects;
    }

    return normalizedProjects.filter((project) => {
      const nameMatches = project.name?.toLowerCase().includes(query);
      const descriptionMatches = project.description?.toLowerCase().includes(query) ?? false;
      const urlMatches = project.url?.toLowerCase().includes(query) ?? false;
      return Boolean(nameMatches || descriptionMatches || urlMatches);
    });
  }, [normalizedProjects, searchFilter]);

  const handleCreateProject = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = projectName.trim();
    const trimmedDescription = projectDescription.trim();

    if (!trimmedName) {
      return;
    }

    const payload: Pick<InsertSite, "name" | "description" | "projectType"> = {
      name: trimmedName,
      description: trimmedDescription ? trimmedDescription : null,
      projectType,
    };

    createProjectMutation.mutate(payload);
  };

  const handleDeleteRequest = (project: ProjectWithStats) => {
    setProjectToDelete({
      id: project.id,
      name: project.name || project.url || "Без названия",
    });
  };

  const isCreatePending = createProjectMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Управление проектами</h1>
          <p className="text-muted-foreground">
            Управляйте знаниями ваших проектов. Настраивайте автоматический краулинг сайтов или загружайте вручную.
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-add-project">
              <Plus className="h-4 w-4" />
              Добавить проект
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Новый проект</DialogTitle>
              <DialogDescription>
                Задайте имя и описание. После создания вы сможете настроить краулинг и загрузить знания.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleCreateProject}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="project-name">
                  Название проекта
                </label>
                <Input
                  id="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="Например, Корпоративный портал"
                  required
                  data-testid="input-project-name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="project-description">
                  Описание
                </label>
                <Textarea
                  id="project-description"
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                  placeholder="Кратко опишите назначение проекта"
                  data-testid="input-project-description"
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="project-type">
                  Тип проекта
                </label>
                <Select
                  value={projectType}
                  onValueChange={(value) => setProjectType(value as ProjectType)}
                >
                  <SelectTrigger id="project-type" data-testid="select-project-type-simple">
                    <SelectValue placeholder="Выберите тип" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="search_engine">
                      <div className="flex flex-col text-left">
                        <span className="font-medium">{projectTypeLabels.search_engine}</span>
                        <span className="text-xs text-muted-foreground">
                          Полнотекстовый поиск и краулинг веб-страниц.
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="vector_search">
                      <div className="flex flex-col text-left">
                        <span className="font-medium">{projectTypeLabels.vector_search}</span>
                        <span className="text-xs text-muted-foreground">
                          Семантический поиск по эмбеддингам (настройки скоро).
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={isCreatePending} data-testid="submit-create-project">
                  {isCreatePending ? "Создание..." : "Создать"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
          <Input
            placeholder="Поиск по названию, описанию или URL"
            value={searchFilter}
            onChange={(event) => setSearchFilter(event.target.value)}
            className="pl-8"
            data-testid="input-filter-search"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Загрузка проектов...</p>
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Не удалось загрузить список проектов.</p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredProjects.map((project) =>
          project.projectType === "vector_search" ? (
            <VectorProjectCard
              key={project.id}
              id={project.id}
              name={project.name ?? project.url ?? "Без названия"}
              description={project.description}
              href={`/admin/sites/${project.id}`}
              onDelete={() => handleDeleteRequest(project)}
            />
          ) : (
            <CrawlStatusCard
              key={project.id}
              crawlStatus={{
                id: project.id,
                url: project.url ?? "URL не задан",
                status: (project.status ?? "idle") as CrawlStatus["status"],
                progress: project.progress ?? 0,
                pagesFound: project.pagesFound ?? 0,
                pagesIndexed: project.pagesIndexed ?? project.pagesFound ?? 0,
                lastCrawled: project.lastCrawled ?? undefined,
                nextCrawl: project.nextCrawl ?? undefined,
                error: project.error ?? undefined,
              }}
              projectName={project.name ?? project.url ?? "Без названия"}
              projectDescription={project.description}
              projectTypeLabel={projectTypeLabels[project.projectType] ?? projectTypeLabels.search_engine}
              href={`/admin/sites/${project.id}`}
              onStart={(id) => startCrawlMutation.mutate(id)}
              onRetry={(id) => startCrawlMutation.mutate(id)}
              onRecrawl={(id) => recrawlMutation.mutate(id)}
              onDelete={() => handleDeleteRequest(project)}
            />
          ),
        )}
      </div>

      {!isLoading && !error && filteredProjects.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <div>
              <p className="text-muted-foreground">
                {searchFilter ? "Проекты не найдены" : "Проекты пока не созданы"}
              </p>
            </div>
            {!searchFilter && (
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Добавить первый проект
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={Boolean(projectToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteProjectMutation.isPending) {
            setProjectToDelete(null);
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-delete-project">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить проект?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие навсегда удалит проект «{projectToDelete?.name}» и все связанные страницы. Отменить его не получится.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending} data-testid="button-cancel-delete-project">
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => projectToDelete && deleteProjectMutation.mutate(projectToDelete.id)}
              disabled={deleteProjectMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-project"
            >
              {deleteProjectMutation.isPending ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VectorProjectCard({ id, name, description, href, onDelete }: VectorProjectCardProps) {
  const card = (
    <Card className="hover-elevate transition-shadow hover:shadow-lg" data-testid={`card-vector-${id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-2">
            <h4 className="text-lg font-semibold leading-tight" data-testid={`text-project-${id}`}>
              {name}
            </h4>
            {description ? (
              <p className="text-sm text-muted-foreground" data-testid={`text-description-${id}`}>
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-destructive hover:text-destructive-foreground hover:bg-destructive/10"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
            data-testid={`button-delete-${id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
    </Card>
  );

  return (
    <Link
      href={href}
      className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  );
}

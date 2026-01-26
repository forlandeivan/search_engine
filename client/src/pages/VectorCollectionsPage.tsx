import { MouseEvent, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RefreshCcw, MoreVertical, Loader2, Copy, Plus, CircleCheck, CircleAlert, CircleDashed, AlertCircle, Database } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface VectorCollection {
  name: string;
  status: string;
  optimizerStatus?: string | { error: string };
  pointsCount: number | null;
  vectorsCount: number | null;
  vectorSize: number | null;
  distance: string | null;
  segmentsCount: number | null;
  error?: string;
}

interface CollectionsResponse {
  collections: VectorCollection[];
}

interface CreateCollectionPayload {
  name: string;
  vectorSize: number;
  distance: "Cosine" | "Euclid" | "Dot" | "Manhattan";
}

type VectorHealthStatus = "ok" | "not_configured" | "error" | "unknown";

interface VectorHealthResponse {
  status: VectorHealthStatus;
  configured: boolean;
  connected: boolean;
  url: string | null;
  apiKeyConfigured: boolean;
  collectionsCount: number | null;
  latencyMs: number | null;
  timestamp: string;
  error?: string;
  errorDetails?: unknown;
  errorName?: string;
  errorCode?: string;
}

const distanceOptions: Array<{ value: CreateCollectionPayload["distance"]; label: string }> = [
  { value: "Cosine", label: "Cosine" },
  { value: "Euclid", label: "Euclid" },
  { value: "Dot", label: "Dot product" },
  { value: "Manhattan", label: "Manhattan" },
];

const vectorSizeOptions = [
  { value: "384", label: "384" },
  { value: "512", label: "512" },
  { value: "768", label: "768" },
  { value: "1024", label: "1024" },
  { value: "1536", label: "1536" },
  { value: "2048", label: "2048" },
  { value: "4096", label: "4096" },
  { value: "custom", label: "Указать свой размер" },
];

export default function VectorCollectionsPage() {
  const { toast } = useToast();
  const [formState, setFormState] = useState({
    name: "",
    vectorSizeOption: "1536",
    customVectorSize: "",
    distance: "Cosine" as CreateCollectionPayload["distance"],
  });
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
  const [location, setLocation] = useLocation();

  const { data, isLoading, isFetching, error, refetch } = useQuery<CollectionsResponse>({
    queryKey: ["/api/vector/collections"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const {
    data: vectorHealth,
    isLoading: isVectorHealthLoading,
    error: vectorHealthError,
  } = useQuery<VectorHealthResponse, Error>({
    queryKey: ["/api/health/vector"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/health/vector");
      return (await response.json()) as VectorHealthResponse;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (payload: CreateCollectionPayload) => {
      const response = await apiRequest("POST", "/api/vector/collections", payload);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Коллекция создана",
        description: "Обновляем список коллекций",
      });
      setFormState({
        name: "",
        vectorSizeOption: "1536",
        customVectorSize: "",
        distance: "Cosine",
      });
      setIsCreateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/vector/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/health/vector"] });
    },
    onError: (mutationError: any) => {
      toast({
        title: "Не удалось создать коллекцию",
        description: mutationError?.message || "Попробуйте ещё раз",
        variant: "destructive",
      });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("DELETE", `/api/vector/collections/${encodeURIComponent(name)}`);
    },
    onMutate: async (name: string) => {
      await queryClient.cancelQueries({ queryKey: ["/api/vector/collections"] });

      const previousData = queryClient.getQueryData<CollectionsResponse>(["/api/vector/collections"]);

      queryClient.setQueryData<CollectionsResponse | undefined>(
        ["/api/vector/collections"],
        (oldData) => {
          if (!oldData) {
            return oldData;
          }

          return {
            collections: oldData.collections.filter((collection) => collection.name !== name),
          };
        },
      );

      setCollectionToDelete(null);

      return { previousData };
    },
    onSuccess: (_, name) => {
      toast({
        title: "Коллекция удалена",
        description: `Коллекция «${name}» удалена из Qdrant`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/health/vector"] });
    },
    onError: (mutationError: any, _name, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["/api/vector/collections"], context.previousData);
      }

      toast({
        title: "Не удалось удалить коллекцию",
        description: mutationError?.message || "Попробуйте ещё раз",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vector/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/health/vector"] });
    },
  });

  const collections = data?.collections ?? [];
  const isInitialLoading = isLoading && !data;
  const isRefreshing = isFetching || isLoading;

  // Автоматически обновляем данные при монтировании компонента и при переходе на страницу
  // Это гарантирует, что после индексации базы знаний новые коллекции появятся без перезагрузки
  useEffect(() => {
    if (location === "/vector/collections") {
      queryClient.invalidateQueries({ queryKey: ["/api/vector/collections"] });
    }
  }, [location]);

  const handleCopyCollectionId = async (event: MouseEvent<HTMLDivElement>, collectionId: string) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(collectionId);
      toast({
        title: "ID коллекции скопирован",
        description: `Идентификатор «${collectionId}» добавлен в буфер обмена.`,
      });
    } catch (error) {
      console.error("Не удалось скопировать идентификатор коллекции", error);
      toast({
        title: "Ошибка копирования",
        description: "Попробуйте выделить идентификатор вручную и повторите попытку.",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.name.trim()) {
      toast({
        title: "Введите название коллекции",
        variant: "destructive",
      });
      return;
    }

    const vectorSizeString =
      formState.vectorSizeOption === "custom" ? formState.customVectorSize : formState.vectorSizeOption;

    if (!vectorSizeString.trim()) {
      toast({
        title: "Укажите размер вектора",
        variant: "destructive",
      });
      return;
    }

    const vectorSizeNumber = Number(vectorSizeString);

    if (!Number.isInteger(vectorSizeNumber) || vectorSizeNumber <= 0) {
      toast({
        title: "Размер вектора должен быть положительным числом",
        variant: "destructive",
      });
      return;
    }

    const payload: CreateCollectionPayload = {
      name: formState.name.trim(),
      vectorSize: vectorSizeNumber,
      distance: formState.distance,
    };

    createCollectionMutation.mutate(payload);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/vector/collections"] });
    queryClient.invalidateQueries({ queryKey: ["/api/health/vector"] });
  };

  const formatErrorDetails = (details: unknown): string | null => {
    if (!details) {
      return null;
    }

    if (typeof details === "string") {
      return details;
    }

    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  };

  const vectorHealthErrorDetails = vectorHealth ? formatErrorDetails(vectorHealth.errorDetails) : null;
  
  const getVectorStatusBadge = () => {
    if (isVectorHealthLoading) {
      return {
        variant: "outline" as const,
        className: "rounded-full bg-blue-500/15 text-blue-700 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
        label: "Проверка...",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
      };
    }
    if (!vectorHealth) {
      return {
        variant: "outline" as const,
        className: "rounded-full bg-gray-500/10 text-gray-600 border-gray-500/20 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/15",
        label: "Неизвестно",
        icon: <CircleDashed className="h-3 w-3" />,
      };
    }
    if (vectorHealth.status === "ok") {
      return {
        variant: "outline" as const,
        className: "rounded-full bg-green-500/15 text-green-700 border-green-500/25 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20",
        label: "Подключено",
        icon: <CircleCheck className="h-3 w-3" />,
      };
    }
    if (vectorHealth.status === "not_configured") {
      return {
        variant: "outline" as const,
        className: "rounded-full bg-yellow-500/15 text-yellow-700 border-yellow-500/25 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20",
        label: "Не настроено",
        icon: <CircleAlert className="h-3 w-3" />,
      };
    }
    if (vectorHealth.status === "error") {
      return {
        variant: "outline" as const,
        className: "rounded-full bg-red-500/15 text-red-700 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
        label: "Ошибка",
        icon: <CircleAlert className="h-3 w-3" />,
      };
    }
    return {
      variant: "outline" as const,
      className: "rounded-full bg-gray-500/10 text-gray-600 border-gray-500/20 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/15",
      label: "Неизвестно",
      icon: <CircleDashed className="h-3 w-3" />,
    };
  };

  const vectorStatusBadge = getVectorStatusBadge();
  
  const vectorHealthTooltipContent = (() => {
    if (isVectorHealthLoading) {
      return <p className="text-xs text-muted-foreground">Проверяем подключение к Qdrant...</p>;
    }
    if (vectorHealth) {
      const statusLabel =
        vectorHealth.status === "ok"
          ? "OK"
          : vectorHealth.status === "not_configured"
            ? "Не настроен"
            : vectorHealth.status === "error"
              ? "Ошибка"
              : "Неизвестен";
      const lastCheck =
        vectorHealth.timestamp && !Number.isNaN(Date.parse(vectorHealth.timestamp))
          ? new Date(vectorHealth.timestamp).toLocaleString()
          : "—";
      return (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="text-[11px] font-semibold text-foreground">
            Статус: {statusLabel}
          </p>
          <p>
            <span className="font-medium">URL:</span>{" "}
            {vectorHealth.url ? <code>{vectorHealth.url}</code> : "не задан"}
          </p>
          <p>
            <span className="font-medium">API ключ:</span>{" "}
            {vectorHealth.apiKeyConfigured ? "задан" : "не задан"}
          </p>
          <p>
            <span className="font-medium">Количество коллекций:</span>{" "}
            {typeof vectorHealth.collectionsCount === "number" ? vectorHealth.collectionsCount : "—"}
          </p>
          <p>
            <span className="font-medium">Задержка ответа:</span>{" "}
            {typeof vectorHealth.latencyMs === "number" ? `${vectorHealth.latencyMs} мс` : "—"}
          </p>
          <p>
            <span className="font-medium">Статус подключения:</span>{" "}
            {vectorHealth.connected ? "подключено" : "отключено"}
          </p>
          {vectorHealth.error && (
            <p className="text-[11px] text-destructive">Ошибка: {vectorHealth.error}</p>
          )}
          {vectorHealth.errorCode && (
            <p className="text-[11px]">
              <span className="font-medium">Код ошибки:</span> <code>{vectorHealth.errorCode}</code>
            </p>
          )}
          {vectorHealth.errorName && (
            <p className="text-[11px]">
              <span className="font-medium">Тип ошибки:</span> {vectorHealth.errorName}
            </p>
          )}
          {vectorHealthErrorDetails && (
            <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-[10px]">
              {vectorHealthErrorDetails}
            </pre>
          )}
          <p className="text-[10px] text-muted-foreground">Последняя проверка: {lastCheck}</p>
        </div>
      );
    }
    if (vectorHealthError) {
      return (
        <p className="text-xs text-destructive">
          {vectorHealthError.message || "Не удалось проверить подключение к Qdrant."}
        </p>
      );
    }
    return <p className="text-xs text-muted-foreground">Статус Qdrant недоступен.</p>;
  })();

  return (
    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
      <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold">Коллекции</h1>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isRefreshing} className="h-8 w-8">
            <RefreshCcw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            <span className="sr-only">Обновить</span>
          </Button>
          <HoverCard>
            <HoverCardTrigger asChild>
              <button type="button" className="cursor-pointer shrink-0">
                <Badge 
                  variant={vectorStatusBadge.variant}
                  className={cn("gap-1.5 border-0", vectorStatusBadge.className)}
                >
                  {vectorStatusBadge.icon}
                  {vectorStatusBadge.label}
                </Badge>
              </button>
            </HoverCardTrigger>
            <HoverCardContent className="max-w-xs">
              {vectorHealthTooltipContent}
            </HoverCardContent>
          </HoverCard>
        </div>
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Создать коллекцию
          </Button>
        </DialogTrigger>
      </div>

      {isInitialLoading ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Загрузка коллекций...</span>
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <Empty className="border-destructive/20">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </EmptyMedia>
            <EmptyTitle>Не удалось загрузить коллекции</EmptyTitle>
            <EmptyDescription>
              {error instanceof Error ? error.message : "неизвестная ошибка"}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Повторить попытку
            </Button>
          </EmptyContent>
        </Empty>
      ) : collections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Database />
            </EmptyMedia>
            <EmptyTitle>Коллекции ещё не созданы</EmptyTitle>
            <EmptyDescription>
              Создайте первую коллекцию для хранения векторных данных.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Создать коллекцию
              </Button>
            </DialogTrigger>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Количество записей</TableHead>
                  <TableHead>Размер вектора</TableHead>
                  <TableHead>Метрика</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((collection) => (
                  <TableRow key={collection.name}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/vector/collections/${encodeURIComponent(collection.name)}`}
                          className="text-primary hover:underline"
                        >
                          {collection.name}
                        </Link>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge
                            variant="outline"
                            onClick={(event) => void handleCopyCollectionId(event, collection.name)}
                            className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                          >
                            <Copy className="h-3.5 w-3.5" /> ID: {collection.name}
                          </Badge>
                        </div>
                        {collection.error && (
                          <span className="text-xs text-destructive">{collection.error}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{collection.pointsCount ?? "—"}</TableCell>
                    <TableCell>{collection.vectorSize ?? "—"}</TableCell>
                    <TableCell>{collection.distance ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                            <span className="sr-only">Открыть действия</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={(event) => {
                              event.preventDefault();
                              setLocation(`/vector/collections/${encodeURIComponent(collection.name)}`);
                            }}
                          >
                            Открыть коллекцию
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={(event) => {
                              event.preventDefault();
                              setCollectionToDelete(collection.name);
                            }}
                          >
                            Удалить коллекцию
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      </div>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Создать коллекцию</DialogTitle>
          <DialogDescription>
            Задайте базовые параметры коллекции. Изменить их после создания будет нельзя.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="collection-name">Название</Label>
            <Input
              id="collection-name"
              placeholder="Например, knowledge-base"
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              disabled={createCollectionMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-vector-size">Размер вектора</Label>
            <Select
              value={formState.vectorSizeOption}
              onValueChange={(value) =>
                setFormState((prev) => ({
                  ...prev,
                  vectorSizeOption: value,
                  customVectorSize: value === "custom" ? prev.customVectorSize : "",
                }))
              }
              disabled={createCollectionMutation.isPending}
            >
              <SelectTrigger id="collection-vector-size">
                <SelectValue placeholder="Выберите размер вектора" />
              </SelectTrigger>
              <SelectContent>
                {vectorSizeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formState.vectorSizeOption === "custom" && (
              <Input
                id="collection-custom-vector-size"
                type="number"
                min={1}
                placeholder="Введите своё значение"
                value={formState.customVectorSize}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    customVectorSize: event.target.value,
                  }))
                }
                disabled={createCollectionMutation.isPending}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-distance">Метрика</Label>
            <Select
              value={formState.distance}
              onValueChange={(value) => setFormState((prev) => ({ ...prev, distance: value as CreateCollectionPayload["distance"] }))}
              disabled={createCollectionMutation.isPending}
            >
              <SelectTrigger id="collection-distance">
                <SelectValue placeholder="Выберите метрику" />
              </SelectTrigger>
              <SelectContent>
                {distanceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createCollectionMutation.isPending}>
              {createCollectionMutation.isPending ? "Создание..." : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog
        open={collectionToDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setCollectionToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить коллекцию?</AlertDialogTitle>
            <AlertDialogDescription>
              {collectionToDelete
                ? `Коллекция «${collectionToDelete}» будет безвозвратно удалена вместе со всеми точками.`
                : "Коллекция будет безвозвратно удалена вместе со всеми точками."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCollectionMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (collectionToDelete) {
                  deleteCollectionMutation.mutate(collectionToDelete);
                }
              }}
              disabled={deleteCollectionMutation.isPending}
            >
              {deleteCollectionMutation.isPending ? "Удаляем..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

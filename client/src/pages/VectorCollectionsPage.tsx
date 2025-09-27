import { useState } from "react";
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
import { RefreshCcw, DatabaseZap, MoreVertical } from "lucide-react";
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
  const [, setLocation] = useLocation();

  const { data, isLoading, isFetching, error } = useQuery<CollectionsResponse>({
    queryKey: ["/api/vector/collections"],
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
    },
  });

  const collections = data?.collections ?? [];
  const isInitialLoading = isLoading && !data;
  const isRefreshing = isFetching || isLoading;

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
  };

  return (
    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
      <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Коллекции</h1>
            <Badge variant="secondary" className="flex items-center gap-1">
              <DatabaseZap className="h-4 w-4" />
              Qdrant
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Управляйте векторными коллекциями и отслеживайте их состояние в Qdrant
          </p>
          {error && (
            <p className="mt-2 text-sm text-destructive">
              Не удалось загрузить данные: {error instanceof Error ? error.message : "неизвестная ошибка"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DialogTrigger asChild>
            <Button>Создать коллекцию</Button>
          </DialogTrigger>
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Список коллекций</CardTitle>
          <CardDescription>
            Отслеживайте параметры каждой коллекции и объём загруженных данных
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isInitialLoading ? (
            <p className="text-muted-foreground">Загрузка коллекций...</p>
          ) : collections.length === 0 ? (
            <p className="text-muted-foreground">Коллекции ещё не созданы.</p>
          ) : (
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
                        <div className="flex flex-col">
                          <Link
                            href={`/vector/collections/${encodeURIComponent(collection.name)}`}
                            className="text-primary hover:underline"
                          >
                            {collection.name}
                          </Link>
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
          )}
        </CardContent>
      </Card>
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

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RefreshCcw, DatabaseZap } from "lucide-react";
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
  onDiskPayload?: boolean;
}

const distanceOptions: Array<{ value: CreateCollectionPayload["distance"]; label: string }> = [
  { value: "Cosine", label: "Cosine" },
  { value: "Euclid", label: "Euclid" },
  { value: "Dot", label: "Dot product" },
  { value: "Manhattan", label: "Manhattan" },
];

export default function VectorCollectionsPage() {
  const { toast } = useToast();
  const [formState, setFormState] = useState({
    name: "",
    vectorSize: "1536",
    distance: "Cosine" as CreateCollectionPayload["distance"],
    onDiskPayload: false,
  });

  const { data, isLoading, isFetching, error } = useQuery<CollectionsResponse>({
    queryKey: ["/api/vector/collections"],
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
        vectorSize: "1536",
        distance: "Cosine",
        onDiskPayload: false,
      });
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

  const collections = data?.collections ?? [];
  const isRefreshing = isLoading || isFetching;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.name.trim()) {
      toast({
        title: "Введите название коллекции",
        variant: "destructive",
      });
      return;
    }

    const vectorSizeNumber = Number(formState.vectorSize);

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
      onDiskPayload: formState.onDiskPayload || undefined,
    };

    createCollectionMutation.mutate(payload);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/vector/collections"] });
  };

  return (
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
        <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Обновить
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Новая коллекция</CardTitle>
          <CardDescription>
            Задайте параметры коллекции и загрузите знания через API /api/vector/collections/&lt;name&gt;/points
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
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
              <Input
                id="collection-vector-size"
                type="number"
                min={1}
                value={formState.vectorSize}
                onChange={(event) => setFormState((prev) => ({ ...prev, vectorSize: event.target.value }))}
                disabled={createCollectionMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label>Метрика</Label>
              <Select
                value={formState.distance}
                onValueChange={(value) => setFormState((prev) => ({ ...prev, distance: value as CreateCollectionPayload["distance"] }))}
                disabled={createCollectionMutation.isPending}
              >
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Checkbox
                  checked={formState.onDiskPayload}
                  onCheckedChange={(checked) =>
                    setFormState((prev) => ({ ...prev, onDiskPayload: checked === true }))
                  }
                  disabled={createCollectionMutation.isPending}
                />
                Хранить payload на диске
              </Label>
              <p className="text-sm text-muted-foreground">
                Включите, если хотите экономить память при больших объёмах данных
              </p>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={createCollectionMutation.isPending}>
                Создать коллекцию
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Список коллекций</CardTitle>
          <CardDescription>
            Получайте знания через /api/vector/collections/&lt;name&gt;/points и ищите их через /api/vector/collections/&lt;name&gt;/search
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isRefreshing ? (
            <p className="text-muted-foreground">Загрузка коллекций...</p>
          ) : collections.length === 0 ? (
            <p className="text-muted-foreground">Коллекции ещё не созданы.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Размер вектора</TableHead>
                    <TableHead>Метрика</TableHead>
                    <TableHead>Точек</TableHead>
                    <TableHead>Сегменты</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((collection) => (
                    <TableRow key={collection.name}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{collection.name}</span>
                          {collection.error && (
                            <span className="text-xs text-destructive">{collection.error}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={collection.status === "green" ? "default" : collection.status === "yellow" ? "secondary" : "outline"}
                        >
                          {collection.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{collection.vectorSize ?? "—"}</TableCell>
                      <TableCell>{collection.distance ?? "—"}</TableCell>
                      <TableCell>{collection.pointsCount ?? "—"}</TableCell>
                      <TableCell>{collection.segmentsCount ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

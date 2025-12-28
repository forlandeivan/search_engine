import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useFileStorageProvidersList, deleteFileStorageProvider } from "@/hooks/useFileStorageProviders";
import type { FileStorageProviderSummary } from "@/types/file-storage-providers";

const DEFAULT_LIMIT = 20;

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function FileStorageProvidersPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const limit = DEFAULT_LIMIT;
  const offset = (page - 1) * limit;
  const { providers, total, isLoading, isError, error, refetch } = useFileStorageProvidersList({ limit, offset });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const handleDelete = async (provider: FileStorageProviderSummary) => {
    if (!window.confirm(`Удалить провайдера "${provider.name}"?`)) return;
    try {
      await deleteFileStorageProvider(provider.id);
      toast({ title: "Удалено", description: `Провайдер "${provider.name}" удалён` });
      void refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось удалить провайдера";
      toast({ variant: "destructive", title: "Ошибка удаления", description: message });
    }
  };

  const paginationItems = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка провайдеров...
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить провайдеров";
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-3xl font-semibold">Файловые провайдеры</h1>
        <p className="text-destructive">{message}</p>
        <Button variant="secondary" onClick={() => refetch()}>
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Файловые провайдеры</h1>
          <p className="text-muted-foreground">
            Список внешних хранилищ файлов, доступных для no-code навыков и вложений.
          </p>
        </div>
        <Button onClick={() => navigate("/admin/file-storage/providers/new")} data-testid="create-file-storage-provider">
          <Plus className="h-4 w-4 mr-2" />
          Создать
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Base URL</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead className="w-[100px] text-center">Статус</TableHead>
              <TableHead className="w-[200px]">Изменён</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.id}>
                <TableCell className="font-medium">{provider.name}</TableCell>
                <TableCell className="font-mono text-sm break-all">{provider.baseUrl}</TableCell>
                <TableCell>{provider.authType === "bearer" ? "Bearer" : "None"}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={provider.isActive ? "default" : "secondary"}>
                    {provider.isActive ? "Активен" : "Выключен"}
                  </Badge>
                </TableCell>
                <TableCell>{formatDateTime(provider.updatedAt)}</TableCell>
                <TableCell className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/admin/file-storage/providers/${provider.id}`)}>
                    Открыть
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(provider)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Провайдеры не найдены. Создайте новый.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {paginationItems.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={item === page ? "default" : "outline"}
              onClick={() => setPage(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

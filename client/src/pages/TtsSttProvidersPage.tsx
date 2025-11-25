import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useSpeechProvidersList } from "@/hooks/useSpeechProviders";
import type { SpeechProviderStatus, SpeechProviderSummary } from "@/types/speech-providers";

const STATUS_META: Record<SpeechProviderStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  Disabled: { label: "Выключен", variant: "secondary" },
  Enabled: { label: "Включен", variant: "default" },
  Error: { label: "Ошибка", variant: "destructive" },
};

const DEFAULT_LIMIT = 10;

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function directionLabel(direction: string) {
  switch (direction) {
    case "audio_to_text":
      return "audio → text";
    case "text_to_speech":
      return "text → audio";
    default:
      return direction;
  }
}

export default function TtsSttProvidersPage() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const limit = DEFAULT_LIMIT;
  const offset = (page - 1) * limit;
  const { providers, total, isLoading, isError, error } = useSpeechProvidersList({ limit, offset });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const handleOpen = (provider: SpeechProviderSummary) => {
    navigate(`/admin/tts-stt/providers/${provider.id}`);
  };

  const paginationItems = useMemo(() => {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }, [totalPages]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка списка провайдеров...
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить провайдеров речи";
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">TTS&STT: провайдеры речи</h1>
        <p className="text-destructive">{message}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">TTS&STT: провайдеры речи</h1>
        <p className="text-muted-foreground">
          Управляйте глобальными настройками распознавания речи. На этом этапе доступен встроенный провайдер Yandex
          SpeechKit.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead className="w-[120px]">Тип</TableHead>
              <TableHead className="w-[150px]">Направление</TableHead>
              <TableHead className="w-[140px]">Статус</TableHead>
              <TableHead className="w-[220px]">Дата изменения настроек</TableHead>
              <TableHead className="w-[200px]">Последний изменил</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((provider) => {
              const statusMeta = STATUS_META[provider.status];
              return (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell>{provider.type}</TableCell>
                  <TableCell>{directionLabel(provider.direction)}</TableCell>
                  <TableCell>
                    <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(provider.lastUpdatedAt)}</TableCell>
                  <TableCell>
                    {provider.updatedByAdmin?.email ?? provider.updatedByAdmin?.id ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => handleOpen(provider)}>
                      Открыть
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Провайдеры речи не найдены. В текущей версии платформы доступен встроенный Yandex SpeechKit.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination className="justify-end">
          <PaginationContent>
            <PaginationPrevious
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className={page === 1 ? "pointer-events-none opacity-50" : undefined}
            />
            {paginationItems.map((item) => (
              <PaginationItem key={item}>
                <PaginationLink isActive={item === page} onClick={() => setPage(item)}>
                  {item}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationNext
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className={page === totalPages ? "pointer-events-none opacity-50" : undefined}
            />
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

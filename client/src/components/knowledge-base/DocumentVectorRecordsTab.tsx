import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { AlertTriangle, Database, FileText, RefreshCw } from "lucide-react";

interface VectorRecord {
  id: string | number | null;
  payload: Record<string, unknown> | null;
  vector: number[] | Record<string, number[]> | null;
  shardKey: string | number | null;
  version: number | null;
}

interface VectorRecordsResponse {
  records: VectorRecord[];
}

interface DocumentVectorRecordsTabProps {
  collectionName: string;
  recordIds: string[];
  documentId?: string;
}

const formatId = (value: string | number | null) => {
  if (value === null || value === undefined) {
    return "—";
  }
  return typeof value === "number" ? value.toLocaleString("ru-RU") : value;
};

function resolveVectorLength(vector: VectorRecord["vector"]): number {
  if (!vector) {
    return 0;
  }

  if (Array.isArray(vector)) {
    return vector.length;
  }

  return Object.values(vector).reduce((sum, current) => sum + current.length, 0);
}

function formatChunkText(payload: Record<string, unknown> | null): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const chunk = payload.chunk;
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  const textValue = (chunk as Record<string, unknown>).text;
  if (typeof textValue !== "string") {
    return "";
  }

  return textValue;
}

export function DocumentVectorRecordsTab({
  collectionName,
  recordIds,
  documentId,
}: DocumentVectorRecordsTabProps) {
  const enabled = recordIds.length > 0 && Boolean(collectionName);
  const queryKey = useMemo(
    () => [
      "knowledge-document-vector-records",
      collectionName,
      recordIds.slice().sort().join(","),
    ],
    [collectionName, recordIds],
  );

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/knowledge/documents/vector-records", {
        collectionName,
        recordIds,
      });
      const json = (await response.json()) as VectorRecordsResponse;
      return json;
    },
    enabled,
  });

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Database className="h-6 w-6" />
        <p>Нет данных о векторных записях для этого документа.</p>
        <p className="text-xs text-muted-foreground/70">
          Убедитесь, что документ векторизован и содержит идентификаторы записей.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="space-y-3 p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Не удалось загрузить записи</AlertTitle>
        <AlertDescription>
          {(error as Error).message || "Попробуйте обновить страницу или повторить запрос позднее."}
        </AlertDescription>
      </Alert>
    );
  }

  const records = data?.records ?? [];

  if (records.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <FileText className="h-6 w-6" />
        <p>Записей для отображения не найдено.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isRefetching && "animate-spin")} />
          Обновить
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Коллекция: <code className="text-xs text-foreground">{collectionName}</code>
          </span>
          <span>Записей: {records.length.toLocaleString("ru-RU")}</span>
        </div>
        {documentId && <span>Документ: {documentId}</span>}
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isRefetching && "animate-spin")} />
          Обновить
        </Button>
      </div>

      <ScrollArea className="flex-1 pr-3">
        <div className="space-y-4">
          {records.map((record, index) => {
            const vectorLength = resolveVectorLength(record.vector);
            const chunkText = formatChunkText(record.payload ?? null);
            const chunkInfo =
              record.payload && typeof record.payload === "object"
                ? (record.payload.chunk as Record<string, unknown> | undefined)
                : undefined;
            const documentInfo =
              record.payload && typeof record.payload === "object"
                ? (record.payload.document as Record<string, unknown> | undefined)
                : undefined;

            const recordKey =
              record.id !== null && record.id !== undefined
                ? String(record.id)
                : `record-${index}`;

            return (
              <Card key={recordKey} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    Идентификатор: <code className="text-foreground">{formatId(record.id)}</code>
                  </span>
                  {record.shardKey && <span>Шард: {record.shardKey}</span>}
                  {typeof record.version === "number" && <span>Версия: {record.version}</span>}
                  <span>Длина вектора: {vectorLength.toLocaleString("ru-RU")}</span>
                </div>

                {documentInfo && (
                  <div className="text-xs text-muted-foreground">
                    {typeof documentInfo.title === "string" && documentInfo.title.trim().length > 0 && (
                      <p>
                        Заголовок документа: <strong className="text-foreground">{String(documentInfo.title)}</strong>
                      </p>
                    )}
                    {typeof documentInfo.updatedAt === "string" && documentInfo.updatedAt.trim().length > 0 && (
                      <p>
                        Обновлён: {new Date(String(documentInfo.updatedAt)).toLocaleString("ru-RU")}
                      </p>
                    )}
                  </div>
                )}

                {chunkInfo && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {typeof chunkInfo.index === "number" && <span>Чанк #{chunkInfo.index + 1}</span>}
                    {typeof chunkInfo.position === "number" && (
                      <span>Позиция: {chunkInfo.position.toLocaleString("ru-RU")}</span>
                    )}
                    {typeof chunkInfo.charCount === "number" && (
                      <span>Символов: {chunkInfo.charCount.toLocaleString("ru-RU")}</span>
                    )}
                    {typeof chunkInfo.wordCount === "number" && (
                      <span>Слов: {chunkInfo.wordCount.toLocaleString("ru-RU")}</span>
                    )}
                  </div>
                )}

                {chunkText && (
                  <Tabs defaultValue="preview" className="w-full">
                    <TabsList>
                      <TabsTrigger value="preview">Текст чанка</TabsTrigger>
                      <TabsTrigger value="json">Payload</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview">
                      <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                        {chunkText}
                      </pre>
                    </TabsContent>
                    <TabsContent value="json">
                      <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                        {JSON.stringify(record.payload, null, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                )}

                {!chunkText && (
                  <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                    {JSON.stringify(record.payload, null, 2)}
                  </pre>
                )}

                {Array.isArray(record.vector) && record.vector.length > 0 && (
                  <div>
                    <Separator className="my-3" />
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                      {record.vector.join(", ")}
                    </pre>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export default DocumentVectorRecordsTab;

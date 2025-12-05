import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { CalendarIcon, Filter, RefreshCcw, Clock, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useAdminWorkspaces } from "@/hooks/useAdminWorkspaces";
import { useAsrExecutionDetail, useAsrExecutionsList } from "@/hooks/useAsrExecutions";
import type { AsrExecutionEvent, AsrExecutionStatus } from "@/types/asr-execution";

const STATUS_BADGES: Record<AsrExecutionStatus, string> = {
  pending: "bg-slate-200 text-slate-800",
  processing: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

const STATUS_LABELS: Record<AsrExecutionStatus, string> = {
  pending: "Ожидание",
  processing: "В работе",
  success: "Успех",
  failed: "Ошибка",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatDuration(ms?: number | null) {
  if (!ms || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}м ${s}с`;
}

function formatSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

const STAGE_LABELS: Record<string, string> = {
  file_uploaded: "Файл загружен",
  audio_message_created: "Создано аудио-сообщение",
  transcript_placeholder_message_created: "Создан placeholder стенограммы",
  asr_request_sent: "Отправлен запрос ASR",
  asr_result_partial: "Частичный результат",
  asr_result_final: "Финальный результат",
  transcript_saved: "Сохранена стенограмма",
  auto_action_triggered: "Автодействие запущено",
  auto_action_completed: "Автодействие завершено",
  transcript_preview_message_created: "Создана карточка превью",
};

export default function AsrExecutionsPage() {
  const [currentLocation, navigate] = useLocation();
  const [isDetailMatch, detailParams] = useRoute("/admin/asr-executions/:executionId");
  const executionId = detailParams?.executionId ?? currentLocation.match(/\/admin\/asr-executions\/([^/?#]+)/i)?.[1];

  const [statusFilter, setStatusFilter] = useState<AsrExecutionStatus | "all">("all");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});

  const { workspaces } = useAdminWorkspaces();
  const { executions, pagination, isLoading, error } = useAsrExecutionsList({
    status: statusFilter === "all" ? undefined : statusFilter,
    workspaceId: workspaceId || undefined,
    from: dateRange.from,
    to: dateRange.to,
    page: 1,
    pageSize: 50,
  });
  const { execution: detail } = useAsrExecutionDetail(executionId ?? null, { enabled: Boolean(executionId) });

  const autoActionUsed = (events?: unknown) => {
    if (!Array.isArray(events)) return false;
    return events.some((e) => (e as AsrExecutionEvent)?.stage === "auto_action_triggered" || (e as AsrExecutionEvent)?.stage === "auto_action_completed");
  };

  const sortedEvents = useMemo(() => {
    const events = Array.isArray(detail?.execution.pipelineEvents) ? detail?.execution.pipelineEvents : [];
    return events.slice().sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta - tb;
    });
  }, [detail?.execution.pipelineEvents]);

  const handleCopy = async (value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      console.error("copy failed", err);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Filter className="h-4 w-4" />
          <span>Журнал запусков ASR (speech-to-text) по этапам пайплайна.</span>
        </div>
        <h1 className="text-2xl font-semibold">ASR executions</h1>
        <p className="text-sm text-muted-foreground">Показываем последние попытки транскрибации.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Фильтры</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Статус</span>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as AsrExecutionStatus | "all")}
                >
                  <option value="all">Все</option>
                  <option value="pending">Ожидание</option>
                  <option value="processing">В работе</option>
                  <option value="success">Успех</option>
                  <option value="failed">Ошибка</option>
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Workspace</span>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm"
                  value={workspaceId || "all"}
                  onChange={(e) => setWorkspaceId(e.target.value === "all" ? "" : e.target.value)}
                >
                  <option value="all">Все</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name ?? ws.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground">Период</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      <span>
                        {dateRange.from
                          ? dateRange.to
                            ? `${dateRange.from.toLocaleDateString()} — ${dateRange.to.toLocaleDateString()}`
                            : dateRange.from.toLocaleDateString()
                          : "Выберите даты"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={(range) => {
                        if (!range) return;
                        setDateRange(range);
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Запуски ({pagination.total})</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => window.location.reload()}>
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Загружаем...</div>
              ) : error ? (
                <div className="p-4 text-sm text-destructive">{error.message}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Время</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Chat</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Файл</TableHead>
                      <TableHead>Размер</TableHead>
                      <TableHead>Длительность</TableHead>
                      <TableHead>Auto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.map((ex) => (
                      <TableRow
                        key={ex.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/admin/asr-executions/${ex.id}`)}
                      >
                        <TableCell className="font-mono text-xs">{ex.id.slice(0, 8)}</TableCell>
                        <TableCell>{formatDate(ex.createdAt)}</TableCell>
                        <TableCell>
                          <Badge className={cn("capitalize", STATUS_BADGES[ex.status])}>
                            {STATUS_LABELS[ex.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>{ex.workspaceName ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {ex.chatId ? ex.chatId.slice(0, 8) : "—"}
                        </TableCell>
                        <TableCell>{ex.provider ?? "—"}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{ex.fileName ?? "—"}</TableCell>
                        <TableCell>{formatSize(ex.fileSizeBytes)}</TableCell>
                        <TableCell>{formatDuration(ex.durationMs)}</TableCell>
                        <TableCell>{autoActionUsed(ex as any) ? "✓" : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Детали</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!executionId ? (
                <div className="text-sm text-muted-foreground">Выберите запуск в списке слева.</div>
              ) : !detail ? (
                <div className="text-sm text-muted-foreground">Загружаем детали...</div>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className={cn(STATUS_BADGES[detail.execution.status])}>
                        {STATUS_LABELS[detail.execution.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{detail.execution.id}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Создано: {formatDate(detail.execution.createdAt)} | Старт: {formatDate(detail.execution.startedAt)} | Завершено: {formatDate(detail.execution.finishedAt)}
                    </div>
                    <div className="text-sm">Длительность: {formatDuration(detail.execution.durationMs)}</div>
                    {detail.execution.errorMessage ? (
                      <div className="text-sm text-destructive">
                        {detail.execution.errorCode ? `[${detail.execution.errorCode}] ` : null}
                        {detail.execution.errorMessage}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-2 text-sm">
                    <DetailRow label="Workspace" value={detail.execution.workspaceName ?? detail.execution.workspaceId} />
                    <DetailRow label="Chat" value={detail.execution.chatId} onCopy={handleCopy} />
                    <DetailRow label="User message (audio)" value={detail.execution.userMessageId} onCopy={handleCopy} />
                    <DetailRow label="Transcript message" value={detail.execution.transcriptMessageId} onCopy={handleCopy} />
                    <DetailRow label="Transcript" value={detail.execution.transcriptId} onCopy={handleCopy} />
                    <DetailRow label="Provider" value={detail.execution.provider} />
                    <DetailRow label="Language" value={detail.execution.language} />
                    <DetailRow label="File name" value={detail.execution.fileName} />
                    <DetailRow label="File size" value={formatSize(detail.execution.fileSizeBytes)} />
                    <DetailRow label="Duration" value={formatDuration(detail.execution.durationMs)} />
                    <DetailRow label="Auto action" value={autoActionUsed(detail.execution.pipelineEvents) ? "Да" : "Нет"} />
                  </div>
                  <div className="pt-2">
                    <h3 className="text-base font-semibold mb-2">Пайплайн</h3>
                    <div className="space-y-2">
                      {sortedEvents.map((evt) => (
                        <div key={evt.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                              <span className="font-semibold">{STAGE_LABELS[evt.stage] ?? evt.stage}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(evt.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                            </span>
                          </div>
                          {evt.details ? (
                            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground bg-white/70 p-2 rounded">
                              {JSON.stringify(evt.details, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                      {sortedEvents.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Событий пока нет.</div>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value?: string | null;
  onCopy?: (value?: string | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs">{value || "—"}</span>
        {value && onCopy ? (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(value)}>
            <Copy className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { CalendarIcon, Filter, RefreshCcw, Clock, Copy, CheckCircle2, XCircle, Circle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
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
import { centsToCredits } from "@shared/credits";
import type { DateRange } from "react-day-picker";

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

function formatCreditsCents(cents?: number | null) {
  if (cents === null || cents === undefined) return "—";
  const credits = centsToCredits(cents);
  return credits.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  transcribe_complete_called: "Вызван callback завершения",
};

// Порядок основных этапов пайплайна (для визуализации прогресса)
const PIPELINE_STAGES_ORDER = [
  "file_uploaded",
  "audio_message_created",
  "asr_request_sent",
  "asr_result_final",
  "transcript_saved",
] as const;

// Опциональные этапы (могут присутствовать или нет)
const OPTIONAL_STAGES = new Set([
  "transcript_placeholder_message_created",
  "asr_result_partial",
  "auto_action_triggered",
  "auto_action_completed",
  "transcript_preview_message_created",
  "transcribe_complete_called",
]);

// Форматирование деталей этапа в человекочитаемый вид
function formatStageDetails(stage: string, details: Record<string, unknown> | null): { key: string; value: string }[] {
  if (!details) return [];
  
  const result: { key: string; value: string }[] = [];
  
  switch (stage) {
    case "file_uploaded":
      if (details.fileName) result.push({ key: "Файл", value: String(details.fileName) });
      if (details.fileSize) result.push({ key: "Размер", value: formatSize(Number(details.fileSize)) });
      if (details.mimeType) result.push({ key: "Тип", value: String(details.mimeType) });
      break;
      
    case "asr_request_sent":
      if (details.fileName) result.push({ key: "Файл", value: String(details.fileName) });
      if (details.durationSeconds) result.push({ key: "Длительность", value: `${Number(details.durationSeconds).toFixed(1)} сек` });
      if (details.elapsed !== undefined) result.push({ key: "Время отправки", value: `${details.elapsed} мс` });
      if (details.objectKey) result.push({ key: "S3 ключ", value: String(details.objectKey) });
      break;
      
    case "asr_result_final":
    case "asr_result_partial":
      if (details.provider) result.push({ key: "Провайдер", value: String(details.provider) });
      if (details.operationId) result.push({ key: "Operation ID", value: String(details.operationId) });
      if (details.previewText) {
        const preview = String(details.previewText);
        result.push({ key: "Текст", value: preview.length > 150 ? preview.slice(0, 150) + "..." : preview });
      }
      break;
      
    case "transcript_saved":
      if (details.transcriptId) result.push({ key: "ID стенограммы", value: String(details.transcriptId) });
      break;
      
    case "transcribe_complete_called":
      if (details.chatId) result.push({ key: "Chat ID", value: String(details.chatId).slice(0, 8) + "..." });
      if (details.operationId) result.push({ key: "Operation ID", value: String(details.operationId) });
      if (details.transcriptId) result.push({ key: "Transcript ID", value: String(details.transcriptId).slice(0, 8) + "..." });
      break;
      
    case "auto_action_triggered":
    case "auto_action_completed":
      if (details.actionType) result.push({ key: "Тип действия", value: String(details.actionType) });
      if (details.skillId) result.push({ key: "Навык", value: String(details.skillId) });
      break;
      
    default:
      // Для неизвестных этапов показываем все поля
      for (const [key, value] of Object.entries(details)) {
        if (value !== null && value !== undefined) {
          const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);
          result.push({ key, value: strValue.length > 100 ? strValue.slice(0, 100) + "..." : strValue });
        }
      }
  }
  
  return result;
}

export default function AsrExecutionsPage() {
  const [currentLocation, navigate] = useLocation();
  const [isDetailMatch, detailParams] = useRoute("/admin/asr-executions/:executionId");
  const executionId = detailParams?.executionId ?? currentLocation.match(/\/admin\/asr-executions\/([^/?#]+)/i)?.[1];

  const [statusFilter, setStatusFilter] = useState<AsrExecutionStatus | "all">("all");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

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
    const events = Array.isArray(detail?.execution?.pipelineEvents) ? detail.execution.pipelineEvents : [];
    return events.slice().sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      return ta - tb;
    });
  }, [detail?.execution?.pipelineEvents]);

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
                        setDateRange({
                          from: range.from,
                          to: range.to,
                        });
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
                      <TableHead>Длительность аудио</TableHead>
                      <TableHead>Кредиты</TableHead>
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
                        <TableCell>{formatCreditsCents(ex.creditsChargedCents)}</TableCell>
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
                      <Badge className={cn(STATUS_BADGES[detail.execution?.status || 'pending'])}>
                        {STATUS_LABELS[detail.execution?.status || 'pending']}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{detail.execution?.id}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Создано: {formatDate(detail.execution?.createdAt)} | Старт: {formatDate(detail.execution?.startedAt)} | Завершено: {formatDate(detail.execution?.finishedAt)}
                    </div>
                    <div className="text-sm">Длительность: {formatDuration(detail.execution?.durationMs)}</div>
                    {detail.execution?.errorMessage ? (
                      <div className="text-sm text-destructive">
                        {detail.execution?.errorCode ? `[${detail.execution.errorCode}] ` : null}
                        {detail.execution.errorMessage}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-2 text-sm">
                    <DetailRow label="Workspace" value={detail.execution?.workspaceName ?? detail.execution?.workspaceId} />
                    <DetailRow label="Chat" value={detail.execution?.chatId} onCopy={handleCopy} />
                    <DetailRow label="User message (audio)" value={detail.execution?.userMessageId} onCopy={handleCopy} />
                    <DetailRow label="Transcript message" value={detail.execution?.transcriptMessageId} onCopy={handleCopy} />
                    <DetailRow label="Transcript" value={detail.execution?.transcriptId} onCopy={handleCopy} />
                    <DetailRow label="Provider" value={detail.execution?.provider} />
                    <DetailRow label="Language" value={detail.execution?.language} />
                    <DetailRow label="File name" value={detail.execution?.fileName} />
                    <DetailRow label="File size" value={formatSize(detail.execution?.fileSizeBytes)} />
                    <DetailRow label="Длительность аудио" value={formatDuration(detail.execution?.durationMs)} />
                    <DetailRow label="Списано кредитов" value={formatCreditsCents(detail.execution?.creditsChargedCents)} />
                    <DetailRow label="Auto action" value={autoActionUsed(detail.execution?.pipelineEvents) ? "Да" : "Нет"} />
                  </div>
                  <PipelineVisualizer 
                    events={sortedEvents} 
                    status={detail.execution?.status || 'pending'}
                    errorMessage={detail.execution?.errorMessage}
                  />
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

// Компонент визуализации пайплайна
function PipelineVisualizer({
  events,
  status,
  errorMessage,
}: {
  events: AsrExecutionEvent[];
  status: AsrExecutionStatus;
  errorMessage?: string | null;
}) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [showRawJson, setShowRawJson] = useState<Set<string>>(new Set());

  // Группируем события по этапам
  const eventsByStage = useMemo(() => {
    const map = new Map<string, AsrExecutionEvent[]>();
    for (const evt of events) {
      const existing = map.get(evt.stage) || [];
      existing.push(evt);
      map.set(evt.stage, existing);
    }
    return map;
  }, [events]);

  // Определяем, какие этапы завершены
  const completedStages = useMemo(() => new Set(events.map(e => e.stage)), [events]);

  // Вычисляем прогресс по основным этапам
  const progress = useMemo(() => {
    const completed = PIPELINE_STAGES_ORDER.filter(s => completedStages.has(s)).length;
    return {
      completed,
      total: PIPELINE_STAGES_ORDER.length,
      percent: Math.round((completed / PIPELINE_STAGES_ORDER.length) * 100),
    };
  }, [completedStages]);

  // Определяем текущий этап (последний выполненный или первый не выполненный)
  const currentStageIndex = useMemo(() => {
    for (let i = PIPELINE_STAGES_ORDER.length - 1; i >= 0; i--) {
      if (completedStages.has(PIPELINE_STAGES_ORDER[i])) {
        return i;
      }
    }
    return -1;
  }, [completedStages]);

  const toggleExpand = (stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  };

  const toggleRawJson = (stage: string) => {
    setShowRawJson(prev => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  };

  const getStageIcon = (stage: string, index: number) => {
    const isCompleted = completedStages.has(stage);
    const isCurrent = index === currentStageIndex + 1 && status === "processing";
    const isFailed = status === "failed" && index === currentStageIndex + 1;

    if (isFailed) {
      return <XCircle className="h-5 w-5 text-rose-500" />;
    }
    if (isCompleted) {
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    }
    if (isCurrent) {
      return <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />;
    }
    return <Circle className="h-5 w-5 text-slate-300" />;
  };

  // Собираем все этапы для отображения (основные + опциональные которые выполнились)
  const allStages = useMemo(() => {
    const stages: { stage: string; isOptional: boolean }[] = [];
    
    // Добавляем основные этапы
    for (const stage of PIPELINE_STAGES_ORDER) {
      stages.push({ stage, isOptional: false });
    }
    
    // Добавляем опциональные этапы которые выполнились (вставляем в правильные места)
    const optionalCompleted = Array.from(completedStages).filter(s => OPTIONAL_STAGES.has(s));
    for (const optStage of optionalCompleted) {
      // Находим позицию по времени
      const optEvents = eventsByStage.get(optStage);
      if (!optEvents?.length) continue;
      
      const optTime = new Date(optEvents[0].timestamp).getTime();
      
      // Находим позицию для вставки
      let insertIdx = stages.length;
      for (let i = 0; i < stages.length; i++) {
        const stageEvents = eventsByStage.get(stages[i].stage);
        if (stageEvents?.length) {
          const stageTime = new Date(stageEvents[0].timestamp).getTime();
          if (optTime < stageTime) {
            insertIdx = i;
            break;
          }
        }
      }
      
      stages.splice(insertIdx, 0, { stage: optStage, isOptional: true });
    }
    
    return stages;
  }, [completedStages, eventsByStage]);

  return (
    <div className="pt-2 space-y-4">
      {/* Заголовок с прогрессом */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Пайплайн</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {progress.completed}/{progress.total} этапов
          </span>
          <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full transition-all duration-300",
                status === "failed" ? "bg-rose-500" : 
                status === "success" ? "bg-emerald-500" : "bg-amber-500"
              )}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          {status === "success" && (
            <Badge className="bg-emerald-100 text-emerald-800">Завершён</Badge>
          )}
          {status === "failed" && (
            <Badge className="bg-rose-100 text-rose-800">Ошибка</Badge>
          )}
          {status === "processing" && (
            <Badge className="bg-amber-100 text-amber-800">В процессе</Badge>
          )}
        </div>
      </div>

      {/* Ошибка если есть */}
      {status === "failed" && errorMessage && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          <span className="font-medium">Ошибка: </span>{errorMessage}
        </div>
      )}

      {/* Список этапов */}
      <div className="space-y-1">
        {allStages.map(({ stage, isOptional }, idx) => {
          const stageEvents = eventsByStage.get(stage) || [];
          const isCompleted = completedStages.has(stage);
          const isExpanded = expandedStages.has(stage);
          const showJson = showRawJson.has(stage);
          const lastEvent = stageEvents[stageEvents.length - 1];
          
          return (
            <div 
              key={stage}
              className={cn(
                "rounded-lg border transition-colors",
                isCompleted 
                  ? "bg-white border-slate-200" 
                  : "bg-slate-50 border-slate-100"
              )}
            >
              {/* Заголовок этапа */}
              <button
                type="button"
                onClick={() => isCompleted && stageEvents.length > 0 && toggleExpand(stage)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 text-left",
                  isCompleted && stageEvents.length > 0 && "cursor-pointer hover:bg-slate-50"
                )}
                disabled={!isCompleted || stageEvents.length === 0}
              >
                {/* Иконка статуса */}
                {getStageIcon(stage, idx)}
                
                {/* Название этапа */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-medium text-sm",
                      isCompleted ? "text-slate-900" : "text-slate-400"
                    )}>
                      {STAGE_LABELS[stage] ?? stage}
                    </span>
                    {isOptional && (
                      <span className="text-xs text-slate-400">(опц.)</span>
                    )}
                  </div>
                  
                  {/* Краткая информация */}
                  {isCompleted && lastEvent && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatStageDetails(stage, lastEvent.details as Record<string, unknown> | null)
                        .slice(0, 2)
                        .map(d => `${d.key}: ${d.value}`)
                        .join(" • ") || "Выполнено"}
                    </div>
                  )}
                </div>
                
                {/* Время */}
                {isCompleted && lastEvent && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(lastEvent.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                )}
                
                {/* Стрелка раскрытия */}
                {isCompleted && stageEvents.length > 0 && (
                  isExpanded 
                    ? <ChevronDown className="h-4 w-4 text-slate-400" />
                    : <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
              </button>
              
              {/* Детали этапа (раскрываемые) */}
              {isExpanded && stageEvents.length > 0 && (
                <div className="px-3 pb-3 pt-0 border-t border-slate-100">
                  {stageEvents.map((evt, evtIdx) => (
                    <div key={evt.id} className="mt-2">
                      {stageEvents.length > 1 && (
                        <div className="text-xs text-muted-foreground mb-1">
                          Событие {evtIdx + 1} из {stageEvents.length} — {new Date(evt.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                        </div>
                      )}
                      
                      {/* Форматированные детали */}
                      {!showJson && evt.details && (
                        <div className="space-y-1 bg-slate-50 rounded p-2">
                          {formatStageDetails(stage, evt.details as Record<string, unknown>).map(({ key, value }) => (
                            <div key={key} className="flex gap-2 text-xs">
                              <span className="text-muted-foreground min-w-[100px]">{key}:</span>
                              <span className="text-slate-700 break-all">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Raw JSON */}
                      {showJson && evt.details && (
                        <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground bg-slate-50 p-2 rounded overflow-auto max-h-48">
                          {JSON.stringify(evt.details, null, 2)}
                        </pre>
                      )}
                      
                      {/* Кнопка переключения JSON/форматированный вид */}
                      {evt.details && (
                        <button
                          type="button"
                          onClick={() => toggleRawJson(stage)}
                          className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                        >
                          {showJson ? "Показать форматированный вид" : "Показать JSON"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        
        {events.length === 0 && (
          <div className="text-sm text-muted-foreground p-4 text-center bg-slate-50 rounded-lg">
            Событий пока нет. Пайплайн не запущен.
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Filter, RefreshCcw } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { useAdminWorkspaces } from "@/hooks/useAdminWorkspaces";
import { useLlmExecutionFiltersState, DEFAULT_EXECUTIONS_DAYS } from "@/hooks/useLlmExecutionFiltersState";
import { useLlmExecutionsList } from "@/hooks/useLlmExecutions";
import { useSkills } from "@/hooks/useSkills";
import { Switch } from "@/components/ui/switch";
import { LlmExecutionDetailsPanel } from "@/components/llm-executions/LlmExecutionDetailsPanel";
import { EXECUTION_STATUS_COLORS, EXECUTION_STATUS_LABELS } from "@/components/llm-executions/status";
import { formatExecutionDuration, formatExecutionTimestamp } from "@/lib/llm-execution-format";
import { cn } from "@/lib/utils";
import type { LlmExecutionStatus } from "@/types/llm-execution";

const STATUS_OPTIONS: Array<{ value: LlmExecutionStatus | "all"; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "success", label: "Успех" },
  { value: "error", label: "Ошибка" },
  { value: "running", label: "Выполняется" },
  { value: "timeout", label: "Таймаут" },
  { value: "cancelled", label: "Отменено" },
  { value: "pending", label: "Ожидание" },
];

export interface LlmExecutionsPageProps {
  selectedExecutionId?: string;
}

export default function LlmExecutionsPage({ selectedExecutionId }: LlmExecutionsPageProps) {
  const {
    params,
    dateRange,
    filters,
    page,
    userInput,
    setDateRange,
    setWorkspaceId,
    setSkillId,
    setStatus,
    setHasError,
    setPage,
    setUserInput,
    resetFilters,
  } = useLlmExecutionFiltersState();
  const { workspaces } = useAdminWorkspaces();
  const workspaceId = filters.workspaceId?.trim() ? filters.workspaceId : null;
  const { skills } = useSkills({ workspaceId, enabled: Boolean(workspaceId) });
  const unicaChatSkill = useMemo(
    () => skills.find((skill) => skill.isSystem && skill.systemKey === "UNICA_CHAT"),
    [skills],
  );
  const [currentLocation, navigate] = useLocation();
  const [isDetailMatch, detailParams] = useRoute("/admin/llm-executions/:executionId");
  const locationExecutionId = useMemo(() => {
    if (detailParams?.executionId) {
      return detailParams.executionId;
    }
    const match = currentLocation.match(/\/admin\/llm-executions\/([^/?#]+)/i);
    return match?.[1];
  }, [currentLocation, detailParams?.executionId]);
  const effectiveExecutionId = selectedExecutionId ?? locationExecutionId;

  const { executions, pagination, isLoading, isFetching, isError, error, refetch } = useLlmExecutionsList(params);
  const [debugEnabled, setDebugEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/llm-debug", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setDebugEnabled(Boolean(data?.enabled)))
      .catch(() => setDebugEnabled(false));
  }, []);

  const toggleDebug = async (value: boolean) => {
    setDebugEnabled(value);
    try {
      await fetch("/api/admin/llm-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: value }),
      });
    } catch {
      // rollback on failure
      setDebugEnabled((prev) => !prev);
    }
  };
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const dateLabel = useMemo(() => {
    if (dateRange?.from && dateRange?.to) {
      return `${format(dateRange.from, "dd.MM.yyyy")} — ${format(dateRange.to, "dd.MM.yyyy")}`;
    }
    if (dateRange?.from) {
      return format(dateRange.from, "dd.MM.yyyy");
    }
    return "Выберите период";
  }, [dateRange]);

  const executionRangeStart = (page - 1) * pagination.pageSize + 1;
  const executionRangeEnd = Math.min(page * pagination.pageSize, pagination.total);

  const handleRowClick = (executionId: string) => {
    if (executionId === effectiveExecutionId) {
      return;
    }
    navigate(`/admin/llm-executions/${executionId}`);
  };

  const handleCloseDetails = () => {
    navigate("/admin/llm-executions");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Filter className="h-4 w-4" />
          <span>Отслеживайте пайплайн навыков и находите сбои по шагам.</span>
        </div>
        <h1 className="text-2xl font-semibold">Журнал запусков LLM</h1>
        <p className="text-sm text-muted-foreground">
          По умолчанию показываем события за последние {DEFAULT_EXECUTIONS_DAYS} дней.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Фильтры</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Период</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                        data-testid="date-range-trigger"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        <span>{dateLabel}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="p-0">
                      <Calendar
                        mode="range"
                        selected={dateRange}
                        onSelect={(range) => {
                          if (!range?.from) {
                            return;
                          }
                          if (!range.to) {
                            setDateRange({ from: range.from, to: range.from });
                          } else {
                            setDateRange(range);
                          }
                          setPage(1);
                        }}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label>Воркспейс</Label>
                  <Select
                    value={filters.workspaceId || "all"}
                    onValueChange={(value) => setWorkspaceId(value === "all" ? "" : value)}
                  >
                    <SelectTrigger data-testid="workspace-select">
                      <SelectValue placeholder="Все воркспейсы" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все воркспейсы</SelectItem>
                      {workspaces.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                          {workspace.name ?? workspace.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Навык</Label>
                  <Select
                    value={filters.skillId || "all"}
                    onValueChange={(value) => setSkillId(value === "all" ? "" : value)}
                  >
                    <SelectTrigger data-testid="skill-select">
                      <SelectValue placeholder="Все навыки" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все навыки</SelectItem>
                      {skills.map((skill) => (
                        <SelectItem key={skill.id} value={skill.id}>
                          {skill.name ?? "Без названия"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 pt-2 text-sm">
                    <Checkbox
                      id="only-unica"
                      checked={Boolean(unicaChatSkill && filters.skillId === unicaChatSkill.id)}
                      onCheckedChange={(checked) => {
                        if (!unicaChatSkill) {
                          return;
                        }
                        if (checked) {
                          setSkillId(unicaChatSkill.id);
                        } else if (filters.skillId === unicaChatSkill.id) {
                          setSkillId("");
                        }
                      }}
                      disabled={!unicaChatSkill}
                    />
                    <Label htmlFor="only-unica" className="text-sm font-normal">
                      Только Unica Chat
                    </Label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>ID пользователя</Label>
                  <Input
                    value={userInput}
                    onChange={(event) => setUserInput(event.target.value)}
                    placeholder="UUID пользователя"
                    data-testid="user-filter-input"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <Label>Статус</Label>
                  <Select
                    value={filters.status || "all"}
                    onValueChange={(value) =>
                      setStatus(value === "all" ? "" : (value as LlmExecutionStatus))
                    }
                  >
                    <SelectTrigger data-testid="status-select">
                      <SelectValue placeholder="Все статусы" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Только с ошибками</Label>
                  <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                    <Checkbox
                      id="has-error"
                      checked={filters.hasError}
                      onCheckedChange={(checked) => setHasError(Boolean(checked))}
                      data-testid="has-error-checkbox"
                    />
                    <Label htmlFor="has-error" className="text-sm font-normal cursor-pointer">
                      Показывать только запуски с ошибками
                    </Label>
                  </div>
                </div>
                <div className="flex items-end justify-end gap-2">
                  <Button variant="ghost" className="gap-2" onClick={resetFilters} data-testid="reset-filters">
                    <RefreshCcw className="h-4 w-4" />
                    Сбросить фильтры
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle>История запусков</CardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      id="llm-debug-toggle"
                      checked={Boolean(debugEnabled)}
                      onCheckedChange={(checked) => toggleDebug(Boolean(checked))}
                      disabled={debugEnabled === null}
                    />
                    <label htmlFor="llm-debug-toggle" className="cursor-pointer">
                      Режим отладки (логировать промпты)
                    </label>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  title="Обновить список"
                >
                  <RefreshCcw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isError ? (
                <div className="text-destructive text-sm">Произошла ошибка при загрузке: {error?.message}</div>
              ) : isLoading ? (
                <div className="space-y-2" data-testid="table-skeleton">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-12 w-full" />
                  ))}
                </div>
              ) : executions.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Запусков не найдено по выбранным фильтрам. Попробуйте изменить параметры или сбросить фильтры.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Показываем {executionRangeStart}–{executionRangeEnd} из {pagination.total} запусков
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">Период: {dateLabel}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Начало</TableHead>
                        <TableHead>Воркспейс</TableHead>
                        <TableHead>Пользователь</TableHead>
                        <TableHead>Навык</TableHead>
                        <TableHead>Chat ID</TableHead>
                        <TableHead className="w-[100px] text-right">Длительность</TableHead>
                        <TableHead className="w-[160px] text-right">Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {executions.map((execution) => {
                        const isSelected = execution.id === selectedExecutionId;
                        return (
                          <TableRow
                            key={execution.id}
                            className={cn("cursor-pointer", isSelected && "bg-muted/60")}
                            onClick={() => handleRowClick(execution.id)}
                          >
                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <span>{formatExecutionTimestamp(execution.startedAt)}</span>
                                <span className="text-xs text-muted-foreground">{execution.id}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{execution.workspaceName ?? "—"}</span>
                                <span className="text-xs text-muted-foreground">{execution.workspaceId}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{execution.userName ?? execution.userEmail ?? "—"}</span>
                                <span className="text-xs text-muted-foreground">{execution.userId ?? "—"}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{execution.skillName ?? "—"}</span>
                                {execution.skillIsSystem && (
                                  <span className="text-xs text-muted-foreground">Системный навык</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {execution.chatId ?? "—"}
                              {execution.userMessagePreview && (
                                <div className="text-xs text-muted-foreground line-clamp-2">
                                  {execution.userMessagePreview}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {formatExecutionDuration(execution.durationMs)}
                            </TableCell>
                            <TableCell className="text-right space-y-1">
                              <Badge
                                className={cn(
                                  "justify-center text-xs",
                                  EXECUTION_STATUS_COLORS[execution.status] ?? "bg-muted text-muted-foreground",
                                )}
                              >
                                {EXECUTION_STATUS_LABELS[execution.status] ?? execution.status}
                              </Badge>
                              {execution.hasError && (
                                <div className="text-xs text-destructive mt-1">Есть ошибки в шагах пайплайна</div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>
                      Записи {executionRangeStart}–{executionRangeEnd} из {pagination.total}
                    </span>
                    <Pagination>
                      <PaginationContent>
                        <PaginationPrevious
                          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                          className={cn(page <= 1 && "pointer-events-none opacity-50")}
                        />
                        {Array.from({ length: totalPages }).map((_, index) => (
                          <PaginationItem key={index}>
                            <PaginationLink isActive={index + 1 === page} onClick={() => setPage(index + 1)}>
                              {index + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationNext
                          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                          className={cn(page >= totalPages && "pointer-events-none opacity-50")}
                        />
                      </PaginationContent>
                    </Pagination>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <LlmExecutionDetailsPanel executionId={effectiveExecutionId} onClose={handleCloseDetails} />
      </div>
    </div>
  );
}

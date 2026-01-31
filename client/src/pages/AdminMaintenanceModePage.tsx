import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDownIcon, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cn } from "@/lib/utils";
import type { MaintenanceModeSettingsDto } from "@shared/maintenance-mode";

type AuditLogItem = {
  id: string;
  eventType: string;
  actorAdminId: string | null;
  occurredAt: string;
  payload: Record<string, unknown> | null;
};

type AuditLogResponse = {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

const DEFAULT_TIME_ZONE = "UTC";
const DEFAULT_START_TIME = "10:00";
const DEFAULT_END_TIME = "11:00";

const timeField = z
  .string()
  .trim()
  .refine((value) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), {
    message: "Укажите время в формате HH:mm",
  });

const formSchema = z
  .object({
    scheduledStartDate: z.date().optional(),
    scheduledStartTime: timeField,
    scheduledEndDate: z.date().optional(),
    scheduledEndTime: timeField,
    forceEnabled: z.boolean(),
    messageTitle: z.string().trim().max(120),
    messageBody: z.string().trim().max(2000),
    publicEta: z.string().trim().max(255),
  })
  .superRefine((value, ctx) => {
    const hasStartDate = Boolean(value.scheduledStartDate);
    const hasStartTime = value.scheduledStartTime.trim().length > 0;
    const hasEndDate = Boolean(value.scheduledEndDate);
    const hasEndTime = value.scheduledEndTime.trim().length > 0;

    if (hasStartDate !== hasStartTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledStartTime"],
        message: "Для начала укажите дату и время",
      });
    }

    if (hasEndDate !== hasEndTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEndTime"],
        message: "Для окончания укажите дату и время",
      });
    }

    const startReady = hasStartDate && hasStartTime;
    const endReady = hasEndDate && hasEndTime;

    if (startReady !== endReady) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEndTime"],
        message: "Дата начала и окончания должны быть заполнены вместе",
      });
      return;
    }

    if (!startReady || !endReady) return;

    const [startHour, startMinute] = value.scheduledStartTime.split(":").map(Number);
    const [endHour, endMinute] = value.scheduledEndTime.split(":").map(Number);

    if (!value.scheduledStartDate || !value.scheduledEndDate) return;

    const startDate = new Date(
      value.scheduledStartDate.getFullYear(),
      value.scheduledStartDate.getMonth(),
      value.scheduledStartDate.getDate(),
      startHour,
      startMinute,
    );
    const endDate = new Date(
      value.scheduledEndDate.getFullYear(),
      value.scheduledEndDate.getMonth(),
      value.scheduledEndDate.getDate(),
      endHour,
      endMinute,
    );

    if (startDate.getTime() >= endDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledEndTime"],
        message: "Окончание должно быть позже начала",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const eventLabels: Record<string, string> = {
  enabled: "Включено",
  disabled: "Выключено",
  schedule_updated: "Расписание",
  message_updated: "Сообщение",
};

function formatAuditPayload(item: AuditLogItem): string {
  if (!item.payload || typeof item.payload !== "object") {
    return "";
  }
  const payload = item.payload as Record<string, any>;
  const before = payload.before ?? {};
  const after = payload.after ?? {};

  if (item.eventType === "schedule_updated") {
    return `start: ${before.scheduledStartAt ?? "-"} -> ${after.scheduledStartAt ?? "-"}, end: ${before.scheduledEndAt ?? "-"} -> ${after.scheduledEndAt ?? "-"}`;
  }
  if (item.eventType === "enabled" || item.eventType === "disabled") {
    return `forceEnabled: ${before.forceEnabled ?? "-"} -> ${after.forceEnabled ?? "-"}`;
  }
  if (item.eventType === "message_updated") {
    return "сообщение обновлено";
  }
  return "";
}

function computeStatus(settings: MaintenanceModeSettingsDto | null): "off" | "scheduled" | "active" {
  if (!settings) return "off";
  if (settings.forceEnabled) return "active";
  if (settings.scheduledStartAt && settings.scheduledEndAt) {
    const start = new Date(settings.scheduledStartAt).getTime();
    const end = new Date(settings.scheduledEndAt).getTime();
    const now = Date.now();
    if (now >= start && now <= end) return "active";
    if (now < start) return "scheduled";
  }
  return "off";
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function listTimeZones(): string[] {
  try {
    const supportedValuesOf = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
    if (typeof supportedValuesOf === "function") {
      const zones = supportedValuesOf("timeZone");
      return zones.length ? zones : [DEFAULT_TIME_ZONE];
    }
  } catch {
    // ignore
  }
  return [DEFAULT_TIME_ZONE];
}

function sanitizeText(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes("�")) return "";
  if (/^[?]+$/.test(trimmed)) return "";
  if (/\?{3,}/.test(trimmed)) return "";
  return trimmed;
}

function formatUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const mins = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${mins}`;
}

function getTimeZoneOffsetMinutesAt(timeZone: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const toParts = (parts: Intl.DateTimeFormatPart[]) => {
    const map: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = Number(part.value);
      }
    }
    return map;
  };

  const tzParts = toParts(formatter.formatToParts(date));
  const tzStamp = Date.UTC(
    tzParts.year,
    tzParts.month - 1,
    tzParts.day,
    tzParts.hour,
    tzParts.minute,
    tzParts.second,
  );

  return Math.round((tzStamp - date.getTime()) / 60000);
}

function getTimeZoneOffsetMinutes(timeZone: string): number {
  return getTimeZoneOffsetMinutesAt(timeZone, new Date());
}

function toZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
  };
}

function utcIsoToFormFields(value: string | null | undefined, timeZone: string) {
  if (!value) {
    return { date: undefined, time: "" };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: undefined, time: "" };
  }

  const parts = toZonedParts(parsed, timeZone);
  const date = new Date(parts.year, parts.month - 1, parts.day);
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;

  return { date, time };
}

function zonedDateTimeToUtcIso(date: Date | undefined, time: string, timeZone: string): string | null {
  if (!date || !time) {
    return null;
  }

  const [hoursRaw, minutesRaw] = time.split(":");
  const hour = Number(hoursRaw);
  const minute = Number(minutesRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  const assumedUtc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute));
  const offsetMinutes = getTimeZoneOffsetMinutesAt(timeZone, assumedUtc);
  const actualUtc = new Date(assumedUtc.getTime() - offsetMinutes * 60000);

  return actualUtc.toISOString();
}

export default function AdminMaintenanceModePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [logFilters, setLogFilters] = useState({
    type: "all",
    dateFrom: "",
    dateTo: "",
  });
  const pageSize = 20;
  const [timeZoneOpen, setTimeZoneOpen] = useState(false);

  const timeZones = useMemo(() => listTimeZones(), []);
  const [timeZone, setTimeZone] = useState(resolveTimeZone);
  const normalizedTimeZone = timeZones.includes(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const timeZoneOptions = useMemo(() => {
    const options = timeZones.map((zone) => {
      const offsetMinutes = getTimeZoneOffsetMinutes(zone);
      return {
        value: zone,
        offsetMinutes,
        label: `${formatUtcOffset(offsetMinutes)} (${zone})`,
      };
    });
    return options.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value));
  }, [timeZones]);

  const { data, isLoading, isError, error, refetch } = useQuery<MaintenanceModeSettingsDto>({
    queryKey: ["/api/admin/settings/maintenance"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/settings/maintenance");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось загрузить настройки режима обслуживания");
      }
      return json as MaintenanceModeSettingsDto;
    },
  });

  const status = useMemo(() => computeStatus(data ?? null), [data]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      scheduledStartDate: undefined,
      scheduledStartTime: DEFAULT_START_TIME,
      scheduledEndDate: undefined,
      scheduledEndTime: DEFAULT_END_TIME,
      forceEnabled: false,
      messageTitle: "",
      messageBody: "",
      publicEta: "",
    },
  });

  useEffect(() => {
    if (!data) return;
    const start = utcIsoToFormFields(data.scheduledStartAt, normalizedTimeZone);
    const end = utcIsoToFormFields(data.scheduledEndAt, normalizedTimeZone);

    form.reset(
      {
        scheduledStartDate: start.date,
        scheduledStartTime: start.time || DEFAULT_START_TIME,
        scheduledEndDate: end.date,
        scheduledEndTime: end.time || DEFAULT_END_TIME,
        forceEnabled: data.forceEnabled ?? false,
        messageTitle: sanitizeText(data.messageTitle),
        messageBody: sanitizeText(data.messageBody),
        publicEta: sanitizeText(data.publicEta),
      },
      { keepDirtyValues: true },
    );
  }, [data, form, normalizedTimeZone]);

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const scheduledStartAt = zonedDateTimeToUtcIso(values.scheduledStartDate, values.scheduledStartTime, normalizedTimeZone);
      const scheduledEndAt = zonedDateTimeToUtcIso(values.scheduledEndDate, values.scheduledEndTime, normalizedTimeZone);
      const hasSchedule = Boolean(scheduledStartAt && scheduledEndAt);

      const payload = {
        scheduledStartAt: hasSchedule ? scheduledStartAt : null,
        scheduledEndAt: hasSchedule ? scheduledEndAt : null,
        forceEnabled: values.forceEnabled,
        messageTitle: values.messageTitle.trim(),
        messageBody: values.messageBody.trim(),
        publicEta: values.publicEta.trim() ? values.publicEta.trim() : null,
      };
      const res = await apiRequest("PUT", "/api/admin/settings/maintenance", payload);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось сохранить настройки режима обслуживания");
      }
      return json as MaintenanceModeSettingsDto;
    },
    onSuccess: (updated) => {
      const start = utcIsoToFormFields(updated.scheduledStartAt, normalizedTimeZone);
      const end = utcIsoToFormFields(updated.scheduledEndAt, normalizedTimeZone);

      form.reset({
        scheduledStartDate: start.date,
        scheduledStartTime: start.time || DEFAULT_START_TIME,
        scheduledEndDate: end.date,
        scheduledEndTime: end.time || DEFAULT_END_TIME,
        forceEnabled: updated.forceEnabled ?? false,
        messageTitle: sanitizeText(updated.messageTitle),
        messageBody: sanitizeText(updated.messageBody),
        publicEta: sanitizeText(updated.publicEta),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/status"] });
      toast({ title: "Настройки сохранены", description: "Режим обслуживания обновлен." });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось сохранить настройки";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const auditQuery = useQuery<AuditLogResponse, Error>({
    queryKey: [
      "/api/admin/settings/maintenance/audit",
      logFilters.type,
      logFilters.dateFrom,
      logFilters.dateTo,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (logFilters.type !== "all") params.set("type", logFilters.type);
      if (logFilters.dateFrom) params.set("dateFrom", logFilters.dateFrom);
      if (logFilters.dateTo) params.set("dateTo", logFilters.dateTo);
      const res = await apiRequest("GET", `/api/admin/settings/maintenance/audit?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось загрузить журнал");
      }
      return json as AuditLogResponse;
    },
    placeholderData: (previousData) => previousData,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаем настройки режима обслуживания...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{(error as Error)?.message ?? "Не удалось загрузить настройки"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <CardTitle>Режим обслуживания</CardTitle>
          <Badge variant={status === "active" ? "destructive" : status === "scheduled" ? "secondary" : "outline"}>
            {status === "active" ? "Активен" : status === "scheduled" ? "Запланирован" : "Выключен"}
          </Badge>
        </div>
        <CardDescription>
          Управление плановым и экстренным обслуживанием. Даты и время интерпретируются в выбранном часовом поясе и
          отправляются на сервер в UTC.
        </CardDescription>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Настройки</CardTitle>
          <CardDescription>Укажите расписание и тексты для пользователей.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-6" onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}>
              <FormField
                control={form.control}
                name="forceEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                    <div>
                      <FormLabel>Экстренно включить</FormLabel>
                      <FormDescription>
                        Включает режим обслуживания немедленно и блокирует запросы.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <Label htmlFor="maintenance-timezone">Часовой пояс</Label>
                <Popover open={timeZoneOpen} onOpenChange={setTimeZoneOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={timeZoneOpen}
                      id="maintenance-timezone"
                      className="w-full justify-between"
                    >
                      {timeZoneOptions.find((zone) => zone.value === normalizedTimeZone)?.label ??
                        "Выберите часовой пояс"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Поиск часового пояса..." className="h-9" />
                      <CommandList>
                        <CommandEmpty>Ничего не найдено.</CommandEmpty>
                        <CommandGroup>
                          {timeZoneOptions.map((zone) => (
                            <CommandItem
                              key={zone.value}
                              value={`${zone.label} ${zone.value}`}
                              onSelect={() => {
                                setTimeZone(zone.value);
                                setTimeZoneOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  normalizedTimeZone === zone.value ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {zone.label}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Даты и время интерпретируются в выбранном часовом поясе.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="scheduledStartDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Дата начала</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className="w-full justify-between font-normal"
                            >
                              {field.value ? field.value.toLocaleDateString("ru-RU") : "Выберите дату"}
                              <ChevronDownIcon className="h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            captionLayout="dropdown"
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="scheduledStartTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Время начала</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          step="60"
                          placeholder="10:30"
                          className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="scheduledEndDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Дата окончания</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className="w-full justify-between font-normal"
                            >
                              {field.value ? field.value.toLocaleDateString("ru-RU") : "Выберите дату"}
                              <ChevronDownIcon className="h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            captionLayout="dropdown"
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="scheduledEndTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Время окончания</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          step="60"
                          placeholder="12:00"
                          className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="messageTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Заголовок сообщения</FormLabel>
                      <FormControl>
                        <Input placeholder="Идут технические работы" {...field} />
                      </FormControl>
                      <FormDescription>Отображается в баннере и на экране обслуживания.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="publicEta"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ETA восстановления</FormLabel>
                      <FormControl>
                        <Input placeholder="Ожидаем восстановление к 23:30" {...field} />
                      </FormControl>
                      <FormDescription>Краткий текст для публичного статуса.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="messageBody"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Описание</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Мы обновляем систему. Скоро все заработает." {...field} />
                    </FormControl>
                    <FormDescription>Подробное описание для пользователей.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2">
                <Button type="submit" disabled={!form.formState.isValid || updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </Button>
                <Button type="button" variant="outline" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Обновить
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Журнал</CardTitle>
          <CardDescription>Последние события режима обслуживания.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Тип события</Label>
              <Select value={logFilters.type} onValueChange={(value) => setLogFilters((prev) => ({ ...prev, type: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="enabled">Включено</SelectItem>
                  <SelectItem value="disabled">Выключено</SelectItem>
                  <SelectItem value="schedule_updated">Расписание</SelectItem>
                  <SelectItem value="message_updated">Сообщение</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>С даты</Label>
              <Input
                type="date"
                value={logFilters.dateFrom}
                onChange={(e) => setLogFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>По дату</Label>
              <Input
                type="date"
                value={logFilters.dateTo}
                onChange={(e) => setLogFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              />
            </div>
          </div>

          {auditQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем журнал...
            </div>
          ) : auditQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Ошибка загрузки</AlertTitle>
              <AlertDescription>{auditQuery.error?.message ?? "Не удалось загрузить журнал"}</AlertDescription>
            </Alert>
          ) : auditQuery.data?.items?.length ? (
            <div className="space-y-3">
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>
                      <th className="px-3 py-2">Дата</th>
                      <th className="px-3 py-2">Событие</th>
                      <th className="px-3 py-2">Админ</th>
                      <th className="px-3 py-2">Детали</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditQuery.data.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(item.occurredAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {eventLabels[item.eventType] ?? item.eventType}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {item.actorAdminId ?? "-"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatAuditPayload(item) || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || auditQuery.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Предыдущая
                </Button>
                <span className="text-sm text-muted-foreground">
                  Стр. {auditQuery.data.page} из {auditQuery.data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= auditQuery.data.totalPages || auditQuery.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Следующая
                </Button>
              </div>
            </div>
          ) : (
            <Alert>
              <AlertTitle>Пока нет записей</AlertTitle>
              <AlertDescription>Измените настройки, чтобы появились события в журнале.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

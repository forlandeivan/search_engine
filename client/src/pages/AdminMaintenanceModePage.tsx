import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDownIcon, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import { cn } from "@/lib/utils";
import type {
  MaintenanceModeIntervalDto,
  MaintenanceModeScheduleDto,
  MaintenanceModeScheduleListItemDto,
  MaintenanceModeSettingsDto,
} from "@shared/maintenance-mode";

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

function computeStatus(
  settings: MaintenanceModeSettingsDto | null,
  schedules: MaintenanceModeScheduleListItemDto[] | undefined,
): "off" | "scheduled" | "active" {
  if (!settings) return "off";
  if (settings.forceEnabled) return "active";
  if (!schedules?.length) return "off";

  const now = Date.now();
  let hasUpcoming = false;

  for (const schedule of schedules) {
    const start = new Date(schedule.scheduledStartAt).getTime();
    const end = new Date(schedule.scheduledEndAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    if (now >= start && now <= end) return "active";
    if (start > now) hasUpcoming = true;
  }

  return hasUpcoming ? "scheduled" : "off";
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
  const [timeZoneOpen, setTimeZoneOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<MaintenanceModeScheduleListItemDto | null>(null);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<
    | { kind: "force" }
    | { kind: "schedule"; schedule: MaintenanceModeScheduleListItemDto; status: "scheduled" | "active" }
    | null
  >(null);

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

  const { data, isLoading, isError, error } = useQuery<MaintenanceModeSettingsDto>({
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

  const scheduleQuery = useQuery<MaintenanceModeScheduleListItemDto[]>({
    queryKey: ["/api/admin/settings/maintenance/schedules"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/settings/maintenance/schedules");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось загрузить расписание обслуживания");
      }
      return (json?.items ?? []) as MaintenanceModeScheduleListItemDto[];
    },
    placeholderData: (previousData) => previousData,
  });

  const status = useMemo(
    () => computeStatus(data ?? null, scheduleQuery.data ?? []),
    [data, scheduleQuery.data],
  );

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
    form.register("scheduledStartDate");
    form.register("scheduledEndDate");
    form.register("scheduledStartTime");
    form.register("scheduledEndTime");
  }, [form]);

  const watchedStartDate = useWatch({ control: form.control, name: "scheduledStartDate" });
  const watchedEndDate = useWatch({ control: form.control, name: "scheduledEndDate" });
  const watchedStartTime = useWatch({ control: form.control, name: "scheduledStartTime" }) ?? "";
  const watchedEndTime = useWatch({ control: form.control, name: "scheduledEndTime" }) ?? "";

  useEffect(() => {
    if (!data) return;
    form.setValue("forceEnabled", data.forceEnabled ?? false, { shouldDirty: false });
    form.setValue("messageTitle", sanitizeText(data.messageTitle), { shouldDirty: false });
    form.setValue("messageBody", sanitizeText(data.messageBody), { shouldDirty: false });
    form.setValue("publicEta", sanitizeText(data.publicEta), { shouldDirty: false });
  }, [data, form]);

  const buildSettingsPayload = (values: FormValues, forceEnabled: boolean) => ({
    forceEnabled,
    messageTitle: values.messageTitle.trim(),
    messageBody: values.messageBody.trim(),
    publicEta: values.publicEta.trim() ? values.publicEta.trim() : null,
  });

  const resetScheduleForm = (schedule?: MaintenanceModeScheduleListItemDto | null) => {
    const start = schedule
      ? utcIsoToFormFields(schedule.scheduledStartAt, normalizedTimeZone)
      : { date: undefined, time: DEFAULT_START_TIME };
    const end = schedule
      ? utcIsoToFormFields(schedule.scheduledEndAt, normalizedTimeZone)
      : { date: undefined, time: DEFAULT_END_TIME };

    form.reset({
      scheduledStartDate: start.date,
      scheduledStartTime: start.time || DEFAULT_START_TIME,
      scheduledEndDate: end.date,
      scheduledEndTime: end.time || DEFAULT_END_TIME,
      forceEnabled: data?.forceEnabled ?? false,
      messageTitle: schedule ? sanitizeText(schedule.messageTitle) : sanitizeText(data?.messageTitle) || "",
      messageBody: schedule ? sanitizeText(schedule.messageBody) : sanitizeText(data?.messageBody) || "",
      publicEta: schedule ? sanitizeText(schedule.publicEta) : sanitizeText(data?.publicEta) || "",
    });
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: ReturnType<typeof buildSettingsPayload>) => {
      const res = await apiRequest("PUT", "/api/admin/settings/maintenance", payload);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось сохранить настройки режима обслуживания");
      }
      return json as MaintenanceModeSettingsDto;
    },
    onSuccess: (updated) => {
      form.setValue("forceEnabled", updated.forceEnabled ?? false, { shouldDirty: false });
      form.setValue("messageTitle", sanitizeText(updated.messageTitle), { shouldDirty: false });
      form.setValue("messageBody", sanitizeText(updated.messageBody), { shouldDirty: false });
      form.setValue("publicEta", sanitizeText(updated.publicEta), { shouldDirty: false });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/maintenance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/maintenance/intervals"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось сохранить настройки";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async ({
      scheduleId,
      values,
      action,
    }: {
      scheduleId?: string;
      values: FormValues;
      action?: "save" | "end";
    }): Promise<MaintenanceModeScheduleDto> => {
      const scheduledStartAt = zonedDateTimeToUtcIso(
        values.scheduledStartDate,
        values.scheduledStartTime,
        normalizedTimeZone,
      );
      const scheduledEndAt = zonedDateTimeToUtcIso(
        values.scheduledEndDate,
        values.scheduledEndTime,
        normalizedTimeZone,
      );

      if (!scheduledStartAt || !scheduledEndAt) {
        throw new Error("Заполните интервал обслуживания");
      }

      const payload = {
        scheduledStartAt,
        scheduledEndAt,
        messageTitle: values.messageTitle.trim(),
        messageBody: values.messageBody.trim(),
        publicEta: values.publicEta.trim() ? values.publicEta.trim() : null,
      };
      const endpoint = scheduleId
        ? `/api/admin/settings/maintenance/schedules/${scheduleId}`
        : "/api/admin/settings/maintenance/schedules";
      const method = scheduleId ? "PUT" : "POST";
      const res = await apiRequest(method, endpoint, payload);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось сохранить расписание");
      }
      return json as MaintenanceModeScheduleDto;
    },
    onSuccess: (_schedule, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/maintenance/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/maintenance/intervals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/status"] });
      if (variables.action !== "end") {
        updateSettingsMutation.mutate(buildSettingsPayload(variables.values, false));
      }
      setScheduleOpen(false);
      setEditingSchedule(null);
      toast({
        title:
          variables.action === "end"
            ? "Обслуживание завершено"
            : variables.scheduleId
              ? "Расписание обновлено"
              : "Расписание добавлено",
        description: variables.action === "end" ? "Интервал завершен досрочно." : "Интервал обслуживания сохранен.",
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось сохранить расписание";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/settings/maintenance/schedules/${scheduleId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось удалить расписание");
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/maintenance/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings/maintenance/intervals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/status"] });
      toast({ title: "Расписание отменено" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось удалить расписание";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const handleForceEnable = () => {
    const values = form.getValues();
    updateSettingsMutation.mutate(buildSettingsPayload(values, true), {
      onSuccess: () => {
        setForceConfirmOpen(false);
        toast({ title: "Режим обслуживания включен" });
      },
    });
  };

  const handleScheduleSubmit = form.handleSubmit((values) => {
    scheduleMutation.mutate({ scheduleId: editingSchedule?.id, values, action: "save" });
  });

  const handleCreateSchedule = () => {
    setEditingSchedule(null);
    resetScheduleForm(null);
    setScheduleOpen(true);
  };

  const handleEditSchedule = (schedule: MaintenanceModeScheduleListItemDto) => {
    setEditingSchedule(schedule);
    resetScheduleForm(schedule);
    setScheduleOpen(true);
  };

  const handleCancelConfirm = () => {
    if (!cancelDialog) return;

    if (cancelDialog.kind === "force") {
      const values = form.getValues();
      updateSettingsMutation.mutate(buildSettingsPayload(values, false), {
        onSuccess: () => {
          setCancelDialog(null);
          toast({ title: "Режим обслуживания выключен" });
        },
      });
      return;
    }

    if (cancelDialog.status === "active") {
      const now = new Date().toISOString();
      const values = form.getValues();
      const startFields = utcIsoToFormFields(cancelDialog.schedule.scheduledStartAt, normalizedTimeZone);
      const endFields = utcIsoToFormFields(now, normalizedTimeZone);
      const startTime = startFields.time || DEFAULT_START_TIME;
      const endTime = endFields.time || DEFAULT_END_TIME;
      if (!startFields.date || !endFields.date) {
        toast({ title: "Ошибка", description: "Не удалось подготовить интервал", variant: "destructive" });
        setCancelDialog(null);
        return;
      }
      scheduleMutation.mutate({
        scheduleId: cancelDialog.schedule.id,
        values: {
          ...values,
          scheduledStartDate: startFields.date,
          scheduledStartTime: startTime,
          scheduledEndDate: endFields.date,
          scheduledEndTime: endTime,
          messageTitle: cancelDialog.schedule.messageTitle ?? values.messageTitle,
          messageBody: cancelDialog.schedule.messageBody ?? values.messageBody,
          publicEta: cancelDialog.schedule.publicEta ?? values.publicEta,
        },
        action: "end",
      });
    } else {
      deleteScheduleMutation.mutate(cancelDialog.schedule.id);
    }

    setCancelDialog(null);
  };

  const intervalsQuery = useQuery<MaintenanceModeIntervalDto[]>({
    queryKey: ["/api/admin/settings/maintenance/intervals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/settings/maintenance/intervals");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось загрузить интервалы");
      }
      return (json?.items ?? []) as MaintenanceModeIntervalDto[];
    },
    placeholderData: (previousData) => previousData,
  });

  const schedules = scheduleQuery.data ?? [];
  const scheduleLookup = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules],
  );

  const journalRows = intervalsQuery.data ?? [];

  if (isLoading) {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="p-6 text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем настройки режима обслуживания...
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>Ошибка загрузки</AlertTitle>
            <AlertDescription>{(error as Error)?.message ?? "Не удалось загрузить настройки"}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 px-6 pt-6">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold">Режим обслуживания</h1>
            <Badge variant={status === "active" ? "destructive" : status === "scheduled" ? "secondary" : "outline"}>
              {status === "active" ? "Активен" : status === "scheduled" ? "Запланирован" : "Выключен"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <AlertDialog open={forceConfirmOpen} onOpenChange={setForceConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={updateSettingsMutation.isPending || status === "active"}
                >
                  Включить прямо сейчас
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Включить экстренный режим?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Режим обслуживания будет активирован немедленно и заблокирует обычные запросы.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={handleForceEnable}>
                    Включить
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              disabled={scheduleMutation.isPending || updateSettingsMutation.isPending}
              onClick={handleCreateSchedule}
            >
              <Plus className="mr-2 h-4 w-4" />
              Запланировать
            </Button>

            <Dialog
              open={scheduleOpen}
              onOpenChange={(open) => {
                setScheduleOpen(open);
                if (!open) {
                  setEditingSchedule(null);
                }
              }}
            >
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingSchedule ? "Редактировать обслуживание" : "Запланировать обслуживание"}
                  </DialogTitle>
                  <DialogDescription>
                    Укажите интервал, часовой пояс и сообщения для пользователей.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form className="space-y-6" onSubmit={handleScheduleSubmit}>
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
                    </div>

                    <FormField
                      control={form.control}
                      name="scheduledEndTime"
                      render={() => {
                        const range: DateRange | undefined = watchedStartDate
                          ? { from: watchedStartDate, to: watchedEndDate ?? undefined }
                          : watchedEndDate
                            ? { from: watchedEndDate, to: undefined }
                            : undefined;

                        const formatDateTime = (date: Date | null | undefined, time: string) => {
                          if (!date) return null;
                          const [h, m] = (time || "00:00").split(":").map(Number);
                          const d = new Date(date);
                          d.setHours(h || 0, m || 0, 0, 0);
                          return d.toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: normalizedTimeZone,
                          });
                        };

                        const displayLabel =
                          range?.from && range?.to
                            ? `${formatDateTime(range.from, watchedStartTime) ?? ""} — ${formatDateTime(range.to, watchedEndTime) ?? ""}`
                            : range?.from
                              ? `${formatDateTime(range.from, watchedStartTime) ?? ""}`
                              : "Выберите интервал";

                        const intervalError =
                          form.formState.errors.scheduledEndTime?.message ??
                          form.formState.errors.scheduledStartTime?.message;

                        return (
                          <FormItem className="space-y-2">
                            <FormLabel>Интервал обслуживания</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" className="w-full justify-between font-normal">
                                  <span className="truncate text-left">{displayLabel}</span>
                                  <ChevronDownIcon className="h-4 w-4 opacity-50 shrink-0" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Card className="w-fit py-4">
                                  <CardContent className="px-4">
                                    <Calendar
                                      mode="range"
                                      defaultMonth={range?.from}
                                      selected={range}
                                      onSelect={(value) => {
                                        form.setValue("scheduledStartDate", value?.from ?? undefined, {
                                          shouldDirty: true,
                                          shouldValidate: true,
                                        });
                                        form.setValue("scheduledEndDate", value?.to ?? undefined, {
                                          shouldDirty: true,
                                          shouldValidate: true,
                                        });
                                      }}
                                      className="bg-transparent p-0 [--cell-size:--spacing(10.5)]"
                                    />
                                  </CardContent>
                                  <CardFooter className="flex gap-2 border-t px-4 !pt-4 *:[div]:w-full">
                                    <div>
                                      <Label htmlFor="maintenance-start-time" className="sr-only">
                                        Start Time
                                      </Label>
                                      <Input
                                        id="maintenance-start-time"
                                        type="time"
                                        step="60"
                                        value={watchedStartTime}
                                        onChange={(e) =>
                                          form.setValue("scheduledStartTime", e.target.value, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                          })
                                        }
                                        className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                                      />
                                    </div>
                                    <span>-</span>
                                    <div>
                                      <Label htmlFor="maintenance-end-time" className="sr-only">
                                        End Time
                                      </Label>
                                      <Input
                                        id="maintenance-end-time"
                                        type="time"
                                        step="60"
                                        value={watchedEndTime}
                                        onChange={(e) =>
                                          form.setValue("scheduledEndTime", e.target.value, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                          })
                                        }
                                        className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                                      />
                                    </div>
                                  </CardFooter>
                                </Card>
                              </PopoverContent>
                            </Popover>
                            {intervalError ? <p className="text-sm text-destructive">{intervalError}</p> : null}
                          </FormItem>
                        );
                      }}
                    />

                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="messageTitle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Заголовок для пользователей</FormLabel>
                            <FormControl>
                              <Input placeholder="Дополнительно" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="publicEta"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Время восстановления</FormLabel>
                            <FormControl>
                              <Input placeholder="Дополнительно" {...field} />
                            </FormControl>
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
                          <FormLabel>Описание для страницы заглушки</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Дополнительно" {...field} />
                          </FormControl>
                          <FormDescription>Подробное описание для пользователей.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <DialogFooter className="gap-2">
                      <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                        Отмена
                      </Button>
                      <Button
                        type="submit"
                        disabled={!form.formState.isValid || scheduleMutation.isPending}
                      >
                        {scheduleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Сохранить
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Журнал</CardTitle>
              <CardDescription>История интервалов режима обслуживания.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {intervalsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаем интервалы...
                </div>
              ) : intervalsQuery.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Ошибка загрузки</AlertTitle>
                  <AlertDescription>
                    {(intervalsQuery.error as Error | undefined)?.message ?? "Не удалось загрузить интервалы"}
                  </AlertDescription>
                </Alert>
              ) : journalRows.length ? (
                <div className="space-y-3">
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left">
                        <tr>
                          <th className="px-3 py-2">Интервал (UTC)</th>
                          <th className="px-3 py-2">Статус</th>
                          <th className="px-3 py-2">Админ</th>
                          <th className="px-3 py-2">Детали</th>
                          <th className="px-3 py-2 text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journalRows.map((row) => {
                          const startLabel = new Date(row.startAt).toLocaleString("ru-RU", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "UTC",
                          });
                          const endLabel = row.endAt
                            ? new Date(row.endAt).toLocaleString("ru-RU", {
                                dateStyle: "medium",
                                timeStyle: "short",
                                timeZone: "UTC",
                              })
                            : null;
                          const intervalLabel = endLabel
                            ? `${startLabel} — ${endLabel} (UTC)`
                            : `С ${startLabel} (UTC)`;
                          const statusLabel =
                            row.status === "active"
                              ? "Активный"
                              : row.status === "scheduled"
                                ? "Запланирован"
                                : "Прошедший";
                          const schedule = row.kind === "schedule" ? scheduleLookup.get(row.id) : null;
                          const details: string[] = [];
                          if (row.kind === "force") {
                            details.push("Экстренный режим");
                          }
                          if (row.messageTitle?.trim()) {
                            details.push(row.messageTitle.trim());
                          }
                          if (row.messageBody?.trim()) {
                            details.push(row.messageBody.trim());
                          }
                          if (row.publicEta?.trim()) {
                            details.push(`ETA: ${row.publicEta.trim()}`);
                          }

                          return (
                            <tr key={row.id} className="border-b last:border-b-0">
                              <td className="px-3 py-2 whitespace-nowrap">{intervalLabel}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{statusLabel}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                                {row.initiatorName ?? "-"}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {details.length ? (
                                  <div className="space-y-1">
                                    {details.map((line) => (
                                      <div key={line}>{line}</div>
                                    ))}
                                  </div>
                                ) : (
                                  "-"
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {row.kind === "force" ? (
                                  row.status === "active" ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={updateSettingsMutation.isPending}
                                      onClick={() => setCancelDialog({ kind: "force" })}
                                    >
                                      Отключить
                                    </Button>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )
                                ) : schedule ? (
                                  row.status === "past" ? (
                                    <span className="text-muted-foreground">-</span>
                                  ) : (
                                    <div className="flex justify-end gap-2">
                                      {row.status === "scheduled" ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled={scheduleMutation.isPending}
                                          onClick={() => handleEditSchedule(schedule)}
                                        >
                                          Редактировать
                                        </Button>
                                      ) : null}
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={scheduleMutation.isPending || deleteScheduleMutation.isPending}
                                        onClick={() =>
                                          setCancelDialog({
                                            kind: "schedule",
                                            schedule,
                                            status: row.status === "active" ? "active" : "scheduled",
                                          })
                                        }
                                      >
                                        {row.status === "active" ? "Отключить" : "Отменить"}
                                      </Button>
                                    </div>
                                  )
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <AlertDialog
                    open={Boolean(cancelDialog)}
                    onOpenChange={(open) => {
                      if (!open) {
                        setCancelDialog(null);
                      }
                    }}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {cancelDialog?.kind === "force"
                            ? "Отключить режим обслуживания?"
                            : cancelDialog?.status === "active"
                              ? "Отключить режим обслуживания?"
                              : "Отменить запланированное обслуживание?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {cancelDialog?.kind === "force"
                            ? "Режим обслуживания будет выключен."
                            : cancelDialog?.status === "active"
                              ? "Интервал будет завершен досрочно. Запись останется в журнале."
                              : "Запланированный интервал будет отменен."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCancelConfirm}>
                          Подтвердить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : (
                <Alert>
                  <AlertTitle>Пока нет интервалов</AlertTitle>
                  <AlertDescription>Добавьте или запустите обслуживание, чтобы появились записи.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
      </div>
    </div>
  </div>
  );
}

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label as UiLabel } from "@/components/ui/label";

// Types

type SmtpSettingsResponse = {
  host: string;
  port: number;
  useTls: boolean;
  useSsl: boolean;
  username?: string | null;
  fromEmail: string;
  fromName?: string | null;
  hasPassword: boolean;
};

type FormValues = {
  host: string;
  port: number | string;
  useTls: boolean;
  useSsl: boolean;
  username?: string;
  password?: string;
  fromEmail: string;
  fromName?: string;
};

type LogItem = {
  id: string;
  createdAt: string;
  sentAt: string | null;
  type: string;
  toEmail: string;
  subject: string;
  status: string;
  bodyPreview?: string | null;
};

type LogsResponse = {
  items: LogItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type LogDetails = LogItem & {
  body?: string | null;
  errorMessage?: string | null;
  smtpResponse?: string | null;
  correlationId?: string | null;
  triggeredByUserId?: string | null;
};

const typeLabels: Record<string, string> = {
  registration_confirmation: "Подтверждение регистрации",
  RegistrationConfirmation: "Подтверждение регистрации",
  smtp_test: "Тест SMTP",
};

const statusClasses: Record<string, string> = {
  Sent: "bg-emerald-100 text-emerald-800",
  sent: "bg-emerald-100 text-emerald-800",
  Failed: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  Queued: "bg-gray-100 text-gray-800",
  queued: "bg-gray-100 text-gray-800",
};

export default function SmtpSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("settings");
  const [logFilters, setLogFilters] = useState({
    email: "",
    type: "all",
    status: "all",
    dateFrom: "",
    dateTo: "",
  });
  const [page, setPage] = useState(1);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const pageSize = 20;

  const { data, isLoading, isError, error, refetch } = useQuery<SmtpSettingsResponse>({
    queryKey: ["/api/admin/settings/smtp"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/settings/smtp");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Не удалось загрузить настройки SMTP");
      }
      return res.json();
    },
  });

  const form = useForm<FormValues>({
    defaultValues: {
      host: "",
      port: 587,
      useTls: true,
      useSsl: false,
      username: "",
      password: "",
      fromEmail: "",
      fromName: "",
    },
    mode: "onChange",
  });

  useEffect(() => {
    if (data) {
      form.reset({
        host: data.host ?? "",
        port: data.port ?? 587,
        useTls: data.useTls ?? false,
        useSsl: data.useSsl ?? false,
        username: data.username ?? "",
        password: "",
        fromEmail: data.fromEmail ?? "",
        fromName: data.fromName ?? "",
      });
    }
  }, [data, form]);

  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<FormValues>) => {
      const body: Record<string, unknown> = {
        host: payload.host,
        port: Number(payload.port),
        useTls: payload.useTls,
        useSsl: payload.useSsl,
        username: payload.username?.trim() ? payload.username.trim() : undefined,
        fromEmail: payload.fromEmail,
        fromName: payload.fromName?.trim() ? payload.fromName.trim() : undefined,
      };
      if (payload.password && payload.password.trim().length > 0) {
        body.password = payload.password.trim();
      }
      const res = await apiRequest("PUT", "/api/admin/settings/smtp", body);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось сохранить настройки SMTP");
      }
      return json as SmtpSettingsResponse;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/admin/settings/smtp"], updated);
      form.reset({
        host: updated.host ?? "",
        port: updated.port ?? 587,
        useTls: updated.useTls ?? false,
        useSsl: updated.useSsl ?? false,
        username: updated.username ?? "",
        password: "",
        fromEmail: updated.fromEmail ?? "",
        fromName: updated.fromName ?? "",
      });
      toast({ title: "Настройки сохранены", description: "SMTP-настройки успешно обновлены." });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось сохранить настройки SMTP";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const testForm = useForm<{ testEmail: string }>({ defaultValues: { testEmail: "" }, mode: "onChange" });

  const sendTestMutation = useMutation({
    mutationFn: async (payload: { testEmail: string }) => {
      const res = await apiRequest("POST", "/api/admin/settings/smtp/test", payload);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.message ?? "Не удалось отправить тестовое письмо";
        const error = new Error(msg);
        (error as any).status = res.status;
        throw error;
      }
      return json as { success: boolean; message: string };
    },
    onSuccess: () => {
      toast({ title: "Тестовое письмо отправлено", description: "Проверьте почтовый ящик получателя." });
      testForm.reset({ testEmail: "" });
      setIsTestModalOpen(false);
    },
    onError: (err: unknown) => {
      const status = (err as any)?.status as number | undefined;
      const message = err instanceof Error ? err.message : "Не удалось отправить тестовое письмо";
      if (status === 400 && message === "SMTP settings are not configured") {
        toast({
          title: "Сначала сохраните настройки",
          description: "Сохраните корректные SMTP-параметры перед отправкой теста.",
          variant: "destructive",
        });
        return;
      }
      if (status === 400 && message === "Invalid test email") {
        testForm.setError("testEmail", { message: "Введите корректный e-mail получателя" });
        return;
      }
      if (status === 429) {
        toast({
          title: "Слишком часто",
          description: "Тестовое письмо можно отправлять не чаще одного раза в 10 секунд.",
          variant: "destructive",
        });
        return;
      }
      if (status === 504) {
        toast({
          title: "Таймаут SMTP",
          description: "Не удалось подключиться к SMTP-серверу. Проверьте хост и порт.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const logsQuery = useQuery<LogsResponse, Error>({
    queryKey: [
      "/api/admin/system-notifications/logs",
      logFilters.email,
      logFilters.type,
      logFilters.status,
      logFilters.dateFrom,
      logFilters.dateTo,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (logFilters.email.trim()) params.set("email", logFilters.email.trim());
      if (logFilters.type !== "all") params.set("type", logFilters.type);
      if (logFilters.status !== "all") params.set("status", logFilters.status);
      if (logFilters.dateFrom) params.set("dateFrom", logFilters.dateFrom);
      if (logFilters.dateTo) params.set("dateTo", logFilters.dateTo);
      const res = await apiRequest("GET", `/api/admin/system-notifications/logs?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message ?? "Не удалось загрузить журнал");
      }
      return json as LogsResponse;
    },
    placeholderData: (previousData) => previousData,
    enabled: activeTab === "logs",
  });

  const logDetailsQuery = useQuery<LogDetails>({
    queryKey: ["/api/admin/system-notifications/logs", selectedLogId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/system-notifications/logs/${selectedLogId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json?.message ?? "Не удалось загрузить детали журнала");
        (err as any).status = res.status;
        throw err;
      }
      return json as LogDetails;
    },
    enabled: Boolean(selectedLogId),
  });

  const renderStatus = (status: string) => {
    const cls = statusClasses[status] ?? "bg-gray-100 text-gray-800";
    return <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs capitalize ${cls}`}>{status}</span>;
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-2">
        <div>
          <CardTitle>SMTP</CardTitle>
          <CardDescription>Настройка SMTP сервера и журнал системных уведомлений</CardDescription>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="logs">Журнал уведомлений</TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем настройки SMTP...
            </div>
          ) : isError ? (
            <Alert variant="destructive">
              <AlertTitle>Ошибка загрузки</AlertTitle>
              <AlertDescription>{(error as Error)?.message ?? "Не удалось загрузить настройки SMTP"}</AlertDescription>
            </Alert>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Настройки SMTP</CardTitle>
                <CardDescription>Укажите параметры SMTP сервера для системных уведомлений</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Form {...form}>
                  <form className="space-y-4" onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}>
                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="host"
                        rules={{ required: "Укажите хост" }}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP хост</FormLabel>
                            <FormControl>
                              <Input placeholder="smtp.example.com" {...field} />
                            </FormControl>
                            <FormDescription>Адрес SMTP сервера</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="port"
                        rules={{ required: "Укажите порт" }}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SMTP порт</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="465"
                                {...field}
                                value={field.value}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                              />
                            </FormControl>
                            <FormDescription>Обычно 465 (SSL) или 587 (TLS)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="useTls"
                        render={({ field }) => (
                          <FormItem className="flex flex-col space-y-2">
                            <FormLabel>Использовать TLS</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormDescription>Включите, если сервер поддерживает STARTTLS</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="useSsl"
                        render={({ field }) => (
                          <FormItem className="flex flex-col space-y-2">
                            <FormLabel>Использовать SSL</FormLabel>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormDescription>Для SMTPS (обычно порт 465)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Имя пользователя</FormLabel>
                            <FormControl>
                              <Input placeholder="smtp-user" {...field} />
                            </FormControl>
                            <FormDescription>Оставьте пустым, если сервер не требует авторизации</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Пароль</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="Введите новый пароль" {...field} />
                            </FormControl>
                            <FormDescription>Пароль хранится безопасно. Оставьте пустым, чтобы не менять текущий пароль.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="fromEmail"
                        rules={{ required: "Укажите адрес отправителя" }}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email отправителя</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="noreply@example.com" {...field} />
                            </FormControl>
                            <FormDescription>Адрес, с которого будут уходить письма</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="fromName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Имя отправителя</FormLabel>
                            <FormControl>
                              <Input placeholder="Unica" {...field} />
                            </FormControl>
                            <FormDescription>Отображаемое имя отправителя (необязательно)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button type="submit" disabled={!form.formState.isValid || updateMutation.isPending}>
                        {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Сохранить
                      </Button>
                      <Button type="button" variant="outline" onClick={() => refetch()}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Обновить
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setIsTestModalOpen(true)}>
                        Отправить тестовое письмо
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Журнал системных уведомлений</CardTitle>
              <CardDescription>История отправки системных писем</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-4 gap-3">
                <div className="space-y-2">
                  <UiLabel>Email получателя</UiLabel>
                  <Input
                    placeholder="user@example.com"
                    value={logFilters.email}
                    onChange={(e) => setLogFilters((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <UiLabel>Тип уведомления</UiLabel>
                  <Select value={logFilters.type} onValueChange={(value) => setLogFilters((prev) => ({ ...prev, type: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Все" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="registration_confirmation">Подтверждение регистрации</SelectItem>
                      <SelectItem value="smtp_test">Тест SMTP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <UiLabel>Статус</UiLabel>
                  <Select value={logFilters.status} onValueChange={(value) => setLogFilters((prev) => ({ ...prev, status: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Все" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="Sent">Sent</SelectItem>
                      <SelectItem value="Failed">Failed</SelectItem>
                      <SelectItem value="Queued">Queued</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <UiLabel>С даты</UiLabel>
                    <Input
                      type="date"
                      value={logFilters.dateFrom}
                      onChange={(e) => setLogFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <UiLabel>По дату</UiLabel>
                    <Input
                      type="date"
                      value={logFilters.dateTo}
                      onChange={(e) => setLogFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    setPage(1);
                    logsQuery.refetch();
                  }}
                  disabled={logsQuery.isFetching}
                >
                  Применить
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setLogFilters({ email: "", type: "all", status: "all", dateFrom: "", dateTo: "" });
                    setPage(1);
                    logsQuery.refetch();
                  }}
                  disabled={logsQuery.isFetching}
                >
                  Сбросить
                </Button>
              </div>

              {logsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаем журнал...
                </div>
              ) : logsQuery.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Ошибка загрузки</AlertTitle>
                  <AlertDescription>
                    {(logsQuery.error as Error)?.message ?? "Не удалось загрузить журнал уведомлений"}
                  </AlertDescription>
                </Alert>
              ) : logsQuery.data?.items?.length ? (
                <div className="space-y-3">
                  <div className="border rounded-md overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left">
                        <tr>
                          <th className="px-3 py-2">Дата</th>
                          <th className="px-3 py-2">Тип</th>
                          <th className="px-3 py-2">Получатель</th>
                          <th className="px-3 py-2">Тема</th>
                          <th className="px-3 py-2">Статус</th>
                          <th className="px-3 py-2">Содержимое</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logsQuery.data.items.map((item) => {
                          const dateToShow = item.sentAt || item.createdAt;
                          const typeLabel = typeLabels[item.type] ?? item.type;
                          return (
                            <tr
                              key={item.id}
                              className="border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"
                              onClick={() => setSelectedLogId(item.id)}
                            >
                              <td className="px-3 py-2 whitespace-nowrap">{new Date(dateToShow).toLocaleString()}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{typeLabel}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{item.toEmail}</td>
                              <td className="px-3 py-2">{item.subject}</td>
                              <td className="px-3 py-2">{renderStatus(item.status)}</td>
                              <td className="px-3 py-2 text-muted-foreground">{item.bodyPreview}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || logsQuery.isFetching}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Предыдущая
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Стр. {logsQuery.data.page} из {logsQuery.data.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={logsQuery.data.page >= logsQuery.data.totalPages || logsQuery.isFetching}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Следующая
                    </Button>
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertTitle>Пока нет записей</AlertTitle>
                  <AlertDescription>
                    Отправьте тестовое письмо или выполните действие, которое отправляет системное письмо (например,
                    регистрацию).
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isTestModalOpen} onOpenChange={setIsTestModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить тестовое письмо</DialogTitle>
            <DialogDescription>
              Укажите адрес получателя. Будет отправлено тестовое письмо через текущий SMTP сервер.
            </DialogDescription>
          </DialogHeader>
          <Form {...testForm}>
            <form className="space-y-4" onSubmit={testForm.handleSubmit((values) => sendTestMutation.mutate(values))}>
              <FormField
                control={testForm.control}
                name="testEmail"
                rules={{ required: "Введите email получателя" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email получателя</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="test@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setIsTestModalOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={sendTestMutation.isPending}>
                  {sendTestMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Отправить
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedLogId)} onOpenChange={(open) => !open && setSelectedLogId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Детали уведомления</DialogTitle>
            <DialogDescription>Полная информация о выбранном письме</DialogDescription>
          </DialogHeader>

          {!selectedLogId ? null : logDetailsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем детали...
            </div>
          ) : logDetailsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Ошибка загрузки</AlertTitle>
              <AlertDescription>
                {(logDetailsQuery.error as Error)?.message ?? "Не удалось загрузить детали журнала"}
              </AlertDescription>
            </Alert>
          ) : logDetailsQuery.data ? (
            <div className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <div>
                  <UiLabel>ID</UiLabel>
                  <div className="text-muted-foreground break-all">{logDetailsQuery.data.id}</div>
                </div>
                <div>
                  <UiLabel>Тип</UiLabel>
                  <div>{typeLabels[logDetailsQuery.data.type] ?? logDetailsQuery.data.type}</div>
                </div>
                <div>
                  <UiLabel>Создано</UiLabel>
                  <div>{new Date(logDetailsQuery.data.createdAt).toLocaleString()}</div>
                </div>
                <div>
                  <UiLabel>Отправлено</UiLabel>
                  <div>{logDetailsQuery.data.sentAt ? new Date(logDetailsQuery.data.sentAt).toLocaleString() : "—"}</div>
                </div>
                <div>
                  <UiLabel>Получатель</UiLabel>
                  <div>{logDetailsQuery.data.toEmail}</div>
                </div>
                <div>
                  <UiLabel>Статус</UiLabel>
                  <div>{renderStatus(logDetailsQuery.data.status)}</div>
                </div>
                <div>
                  <UiLabel>Тема</UiLabel>
                  <div className="text-muted-foreground">{logDetailsQuery.data.subject}</div>
                </div>
                {logDetailsQuery.data.triggeredByUserId ? (
                  <div>
                    <UiLabel>Инициатор</UiLabel>
                    <div className="text-muted-foreground">{logDetailsQuery.data.triggeredByUserId}</div>
                  </div>
                ) : null}
                {logDetailsQuery.data.correlationId ? (
                  <div>
                    <UiLabel>ID запроса</UiLabel>
                    <div className="text-muted-foreground break-all">{logDetailsQuery.data.correlationId}</div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1">
                <UiLabel>Краткое содержимое</UiLabel>
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {logDetailsQuery.data.bodyPreview || "Нет превью"}
                </div>
              </div>

              <div className="space-y-1">
                <UiLabel>Тело письма</UiLabel>
                <div className="rounded-md border p-3 text-sm max-h-64 overflow-auto whitespace-pre-wrap">
                  {logDetailsQuery.data.body && logDetailsQuery.data.body.trim().length > 0
                    ? logDetailsQuery.data.body
                    : "Тело письма не сохранено"}
                </div>
              </div>

              {logDetailsQuery.data.errorMessage ? (
                <div className="space-y-1">
                  <UiLabel>Ошибка</UiLabel>
                  <div className="rounded-md bg-red-50 text-red-800 p-3 text-sm">{logDetailsQuery.data.errorMessage}</div>
                </div>
              ) : null}

              {logDetailsQuery.data.smtpResponse ? (
                <div className="space-y-1">
                  <UiLabel>Ответ SMTP</UiLabel>
                  <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                    {logDetailsQuery.data.smtpResponse}
                  </div>
                </div>
              ) : null}

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedLogId(null)}>
                  Закрыть
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

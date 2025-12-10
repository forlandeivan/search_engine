import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

export default function SmtpSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SmtpSettingsResponse>({
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
      toast({
        title: "Настройки сохранены",
        description: "SMTP-настройки успешно обновлены.",
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Не удалось сохранить настройки SMTP";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
    },
  });

  const testForm = useForm<{ testEmail: string }>({
    defaultValues: { testEmail: "" },
    mode: "onChange",
  });

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
      toast({
        title: "Тестовое письмо отправлено",
        description: "Проверьте почтовый ящик получателя.",
      });
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
      toast({
        title: "Ошибка",
        description: message || "Ошибка отправки тестового письма",
        variant: "destructive",
      });
    },
  });

  // Дополнительная проверка TLS/SSL в рантайме
  const useTls = form.watch("useTls");
  const useSsl = form.watch("useSsl");
  useEffect(() => {
    if (useTls && useSsl) {
      form.setError("useSsl", { message: "Нельзя одновременно включать TLS и SSL" });
    } else {
      form.clearErrors(["useSsl", "useTls"]);
    }
  }, [useTls, useSsl, form]);

  const onSubmit = (values: FormValues) => {
    // Клиентская валидация, чтобы не отправлять мусор
    let hasError = false;

    if (!values.host?.trim()) {
      form.setError("host", { message: "Укажите SMTP хост" });
      hasError = true;
    } else if (values.host.trim().length > 255) {
      form.setError("host", { message: "Слишком длинное значение" });
      hasError = true;
    }

    const portNum = Number(values.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      form.setError("port", { message: "Порт должен быть от 1 до 65535" });
      hasError = true;
    }

    if (!values.fromEmail?.trim()) {
      form.setError("fromEmail", { message: "Укажите e-mail отправителя" });
      hasError = true;
    } else if (!/\S+@\S+\.\S+/.test(values.fromEmail.trim()) || values.fromEmail.trim().length > 255) {
      form.setError("fromEmail", { message: "Введите корректный e-mail" });
      hasError = true;
    }

    if (values.username && values.username.length > 255) {
      form.setError("username", { message: "Слишком длинное значение" });
      hasError = true;
    }

    if (values.password && values.password.length > 255) {
      form.setError("password", { message: "Слишком длинное значение" });
      hasError = true;
    }

    if (values.fromName && values.fromName.length > 255) {
      form.setError("fromName", { message: "Слишком длинное значение" });
      hasError = true;
    }

    if (values.useTls && values.useSsl) {
      form.setError("useSsl", { message: "Нельзя одновременно включать TLS и SSL" });
      hasError = true;
    }

    if (hasError) {
      return;
    }

    updateMutation.mutate({
      ...values,
      port: portNum,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить настройки SMTP</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : "Попробуйте обновить страницу"}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Повторить попытку
        </Button>
      </div>
    );
  }

  const hasPassword = data?.hasPassword ?? false;

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Настройки SMTP</h1>
        <p className="text-muted-foreground">
          Укажите параметры SMTP-сервера для системных писем (подтверждение регистрации, сброс пароля и т.д.).
        </p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Параметры подключения</CardTitle>
          <CardDescription>Сохранение применяется сразу. Пароль не отображается — введите новый, чтобы заменить старый.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="host"
                  rules={{
                    required: "Укажите SMTP хост",
                    maxLength: { value: 255, message: "Слишком длинное значение" },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP хост</FormLabel>
                      <FormControl>
                        <Input placeholder="smtp.example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="port"
                  rules={{
                    required: "Укажите порт",
                    min: { value: 1, message: "Порт должен быть от 1 до 65535" },
                    max: { value: 65535, message: "Порт должен быть от 1 до 65535" },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Порт</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={65535} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="useTls"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>Использовать TLS</FormLabel>
                        <FormDescription>STARTTLS или аналогичный режим шифрования.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="useSsl"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>Использовать SSL</FormLabel>
                        <FormDescription>Прямое SSL-подключение к SMTP.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="username"
                  rules={{ maxLength: { value: 255, message: "Слишком длинное значение" } }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Имя пользователя</FormLabel>
                      <FormControl>
                        <Input placeholder="noreply@example.com" {...field} />
                      </FormControl>
                      <FormDescription>Оставьте пустым, если SMTP не требует аутентификации.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  rules={{ maxLength: { value: 255, message: "Слишком длинное значение" } }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Пароль</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={hasPassword ? "Пароль задан — введите новый, чтобы заменить" : "Введите пароль"} {...field} />
                      </FormControl>
                      <FormDescription>
                        Пароль не отображается. Введите новое значение, чтобы заменить сохранённый пароль.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="fromEmail"
                  rules={{
                    required: "Укажите e-mail отправителя",
                    maxLength: { value: 255, message: "Слишком длинное значение" },
                    pattern: { value: /\S+@\S+\.\S+/, message: "Введите корректный e-mail" },
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail отправителя</FormLabel>
                      <FormControl>
                        <Input placeholder="noreply@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fromName"
                  rules={{ maxLength: { value: 255, message: "Слишком длинное значение" } }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Имя отправителя</FormLabel>
                      <FormControl>
                        <Input placeholder="Unica" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={updateMutation.isPending || !form.formState.isValid}>
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Сохранить
                </Button>
                <Button type="button" variant="outline" onClick={() => refetch()} disabled={isLoading}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Обновить
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Проверка настроек</CardTitle>
          <CardDescription>Отправьте тестовое письмо, чтобы убедиться, что SMTP работает корректно.</CardDescription>
        </CardHeader>
        <CardContent>
                <Button
                  variant="outline"
                  onClick={() => setIsTestModalOpen(true)}
                  disabled={!form.formState.isValid}
                >
                  Отправить тестовое письмо
                </Button>
          {!form.formState.isValid && (
            <p className="text-sm text-muted-foreground mt-2">
              Сначала заполните и сохраните корректные настройки SMTP.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isTestModalOpen} onOpenChange={(open) => {
        setIsTestModalOpen(open);
        if (!open) {
          testForm.reset({ testEmail: "" });
          sendTestMutation.reset?.();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить тестовое письмо</DialogTitle>
            <DialogDescription>Укажите e-mail, на который отправим тестовое письмо.</DialogDescription>
          </DialogHeader>
          <Form {...testForm}>
            <form
              onSubmit={testForm.handleSubmit((values) => sendTestMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={testForm.control}
                name="testEmail"
                rules={{
                  required: "Укажите e-mail",
                  maxLength: { value: 255, message: "Слишком длинное значение" },
                  pattern: { value: /\S+@\S+\.\S+/, message: "Введите корректный e-mail" },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Получатель</FormLabel>
                    <FormControl>
                      <Input placeholder="admin@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setIsTestModalOpen(false)} disabled={sendTestMutation.isPending}>
                  Отмена
                </Button>
                <Button type="submit" disabled={sendTestMutation.isPending || !testForm.formState.isValid}>
                  {sendTestMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Отправить
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

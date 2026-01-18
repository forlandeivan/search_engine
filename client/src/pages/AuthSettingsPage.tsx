import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, RefreshCw, AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import type { AuthProviderType } from "@shared/schema";

const callbackUrlSchema = z
  .string()
  .trim()
  .min(1, "Укажите Callback URL")
  .max(500, "Слишком длинный Callback URL")
  .refine(
    (value) => {
      if (value.startsWith("/")) {
        return true;
      }

      try {
        void new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Введите абсолютный URL или путь, начинающийся с /",
    },
  );

const formSchema = z.object({
  clientId: z.string().trim().max(200, "Слишком длинный Client ID"),
  clientSecret: z.string().trim().max(200, "Слишком длинный Client Secret").optional(),
  callbackUrl: callbackUrlSchema,
  isEnabled: z.boolean(),
});

const MASKED_SECRET_PLACEHOLDER = "••••••••";

type AuthProviderResponse = {
  provider: AuthProviderType;
  clientId: string;
  callbackUrl: string;
  isEnabled: boolean;
  hasClientSecret: boolean;
  source: "database" | "environment";
};

type AuthProviderConfig = {
  provider: AuthProviderType;
  providerLabel: string;
  title: string;
  description: string;
  environmentDescription: string;
  enableLabel: string;
  enableDescription: string;
  clientIdPlaceholder: string;
  clientIdDescription: string;
  callbackPlaceholder: string;
  callbackDescription: string;
  defaultCallback: string;
  toastEnabled: string;
  toastDisabled: string;
  statusReadyDescription: string;
  statusNeedsSetup: string;
  statusDisabled: string;
};

const providerConfigs: AuthProviderConfig[] = [
  {
    provider: "google",
    providerLabel: "Google",
    title: "Google OAuth",
    description: "Настройки хранятся в базе данных и применяются сразу после сохранения.",
    environmentDescription:
      "Сейчас используются переменные окружения. Сохранение формы создаст настройки в базе данных и переопределит значения для Google.",
    enableLabel: "Включить вход через Google",
    enableDescription: "При включении пользователи смогут авторизоваться с помощью корпоративного аккаунта Google.",
    clientIdPlaceholder: "1234567890-abcdefg.apps.googleusercontent.com",
    clientIdDescription: "Укажите идентификатор OAuth-клиента из консоли Google Cloud.",
    callbackPlaceholder: "https://app.example.com/api/auth/google/callback",
    callbackDescription: "Путь, на который Google перенаправит пользователя после успешной аутентификации.",
    defaultCallback: "/api/auth/google/callback",
    toastEnabled: "Вход через Google включён. Изменения применены сразу.",
    toastDisabled: "Настройки сохранены. Вход через Google выключен.",
    statusReadyDescription: "Пользователи могут входить через Google.",
    statusNeedsSetup: "Укажите Client ID и секрет, чтобы включить вход через Google.",
    statusDisabled: "Вход через Google сейчас недоступен.",
  },
  {
    provider: "yandex",
    providerLabel: "Yandex",
    title: "Yandex OAuth",
    description: "Настройки хранятся в базе данных и применяются сразу после сохранения.",
    environmentDescription:
      "Сейчас используются переменные окружения. Сохранение формы создаст настройки в базе данных и переопределит значения для Yandex.",
    enableLabel: "Включить вход через Yandex",
    enableDescription: "После включения пользователи смогут авторизоваться через аккаунт Yandex ID.",
    clientIdPlaceholder: "0123456789abcdef0123456789abcdef",
    clientIdDescription: "Укажите идентификатор OAuth-приложения в кабинете разработчика Yandex ID.",
    callbackPlaceholder: "https://app.example.com/api/auth/yandex/callback",
    callbackDescription: "Путь, на который Yandex перенаправит пользователя после успешной аутентификации.",
    defaultCallback: "/api/auth/yandex/callback",
    toastEnabled: "Вход через Yandex включён. Изменения применены сразу.",
    toastDisabled: "Настройки сохранены. Вход через Yandex выключен.",
    statusReadyDescription: "Пользователи могут входить через Yandex.",
    statusNeedsSetup: "Укажите Client ID и секрет, чтобы включить вход через Yandex.",
    statusDisabled: "Вход через Yandex сейчас недоступен.",
  },
];

function getDefaultValues(config: AuthProviderConfig) {
  return {
    clientId: "",
    clientSecret: "",
    callbackUrl: config.defaultCallback,
    isEnabled: false,
  } satisfies z.infer<typeof formSchema>;
}

function buildFormValues(
  data: AuthProviderResponse | undefined,
  config: AuthProviderConfig,
): z.infer<typeof formSchema> {
  return {
    clientId: data?.clientId ?? "",
    clientSecret: data?.hasClientSecret ? MASKED_SECRET_PLACEHOLDER : "",
    callbackUrl: data?.callbackUrl ?? config.defaultCallback,
    isEnabled: data?.isEnabled ?? false,
  };
}

function AuthProviderSettingsCard({ config }: { config: AuthProviderConfig }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery<AuthProviderResponse>({
    queryKey: [`/api/admin/auth/providers/${config.provider}`],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: getDefaultValues(config),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      form.reset(buildFormValues(settingsQuery.data, config));
    }
  }, [settingsQuery.data, config, form]);

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const trimmedClientId = values.clientId.trim();
      const trimmedCallbackUrl = values.callbackUrl.trim();
      const rawClientSecret = values.clientSecret ?? "";
      const trimmedClientSecret = rawClientSecret.trim();
      const isMaskedSecret = rawClientSecret === MASKED_SECRET_PLACEHOLDER;
      const hasStoredSecret = Boolean(settingsQuery.data?.hasClientSecret);
      const shouldUpdateSecret = trimmedClientSecret.length > 0 && !isMaskedSecret;
      const shouldClearSecret = !isMaskedSecret && trimmedClientSecret.length === 0 && hasStoredSecret;
      const willHaveSecret = shouldUpdateSecret || (hasStoredSecret && !shouldClearSecret);

      if (values.isEnabled && trimmedClientId.length === 0) {
        form.setError("clientId", { message: "Укажите Client ID" });
        throw new Error("Заполните Client ID");
      }

      if (values.isEnabled && !willHaveSecret) {
        form.setError("clientSecret", { message: "Укажите Client Secret" });
        throw new Error("Заполните Client Secret");
      }

      const payload: Record<string, unknown> = {
        provider: config.provider,
        clientId: trimmedClientId,
        callbackUrl: trimmedCallbackUrl,
        isEnabled: values.isEnabled,
      };

      if (shouldUpdateSecret) {
        payload.clientSecret = trimmedClientSecret;
      } else if (!hasStoredSecret || shouldClearSecret) {
        payload.clientSecret = "";
      }

      const response = await apiRequest("PUT", `/api/admin/auth/providers/${config.provider}`, payload);
      const result = (await response.json()) as AuthProviderResponse;

      queryClient.setQueryData([`/api/admin/auth/providers/${config.provider}`], result);
      return result;
    },
    onSuccess: (result) => {
      form.reset(buildFormValues(result, config));
      toast({
        title: "Настройки сохранены",
        description: result.isEnabled ? config.toastEnabled : config.toastDisabled,
      });
    },
    onError: (error) => {
      if (error instanceof Error) {
        toast({
          title: "Не удалось сохранить настройки",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  const isLoading = settingsQuery.isLoading;
  const isSaving = mutation.isPending;
  const hasChanges = form.formState.isDirty;
  const canSubmit = hasChanges && !isLoading && !isSaving;
  const showSubmitButton = hasChanges || isSaving;

  const infoDescription = useMemo(() => {
    if (!settingsQuery.data) {
      return config.description;
    }

    return settingsQuery.data.source === "environment"
      ? config.environmentDescription
      : config.description;
  }, [settingsQuery.data, config]);

  const clientIdValue = form.watch("clientId");
  const clientSecretValue = form.watch("clientSecret");
  const isEnabledValue = form.watch("isEnabled");
  const trimmedClientId = clientIdValue?.trim() ?? "";
  const trimmedClientSecret = clientSecretValue?.trim() ?? "";
  const isMaskedSecret = clientSecretValue === MASKED_SECRET_PLACEHOLDER;
  const hasStoredSecret = Boolean(settingsQuery.data?.hasClientSecret);
  const hasSecretConfigured =
    (trimmedClientSecret.length > 0 && !isMaskedSecret) || (isMaskedSecret && hasStoredSecret);

  const statusInfo = useMemo(() => {
    if (isSaving) {
      return {
        variant: "secondary" as const,
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        label: "Сохраняем настройки...",
        description: "Проверяем и применяем новые параметры.",
      };
    }

    if (!isEnabledValue) {
      return {
        variant: "secondary" as const,
        icon: <CircleDashed className="h-4 w-4" />,
        label: "Провайдер выключен",
        description: config.statusDisabled,
      };
    }

    if (trimmedClientId.length > 0 && hasSecretConfigured) {
      return {
        variant: "default" as const,
        icon: <CheckCircle2 className="h-4 w-4" />,
        label: "Провайдер подключён",
        description: hasChanges
          ? "Изменения ещё не сохранены. Нажмите «Сохранить изменения»."
          : config.statusReadyDescription,
      };
    }

    return {
      variant: "destructive" as const,
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Требуется настройка",
      description: config.statusNeedsSetup,
    };
  }, [config, hasChanges, hasSecretConfigured, isEnabledValue, isSaving, trimmedClientId.length]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle>{config.title}</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => settingsQuery.refetch()}
            disabled={settingsQuery.isFetching}
          >
            {settingsQuery.isFetching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Обновляем...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" /> Обновить данные
              </>
            )}
          </Button>
        </div>
        <CardDescription>{infoDescription}</CardDescription>
        {statusInfo ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={statusInfo.variant} className="flex items-center gap-1">
              {statusInfo.icon}
              {statusInfo.label}
            </Badge>
            {statusInfo.description ? (
              <span className="text-muted-foreground">{statusInfo.description}</span>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-6">
          <CardContent className="space-y-6">
            {settingsQuery.isError && (
              <Alert variant="destructive">
                <AlertTitle>Не удалось загрузить настройки</AlertTitle>
                <AlertDescription>
                  {settingsQuery.error instanceof Error
                    ? settingsQuery.error.message
                    : "Попробуйте обновить страницу или повторить запрос позже."}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="isEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{config.enableLabel}</FormLabel>
                    <FormDescription>{config.enableDescription}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isLoading || isSaving}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      placeholder={config.clientIdPlaceholder}
                      disabled={isLoading || isSaving}
                    />
                  </FormControl>
                  <FormDescription>{config.clientIdDescription}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Secret</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="password"
                      placeholder={
                        settingsQuery.data?.hasClientSecret
                          ? "Секрет сохранён. Введите новый, чтобы обновить."
                          : "Секрет OAuth-клиента"
                      }
                      disabled={isLoading || isSaving}
                    />
                  </FormControl>
                  <FormDescription>
                    Значение хранится в зашифрованном виде и не отображается повторно. Чтобы обновить секрет, введите новое
                    значение и сохраните настройки.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="callbackUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Callback URL</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      placeholder={config.callbackPlaceholder}
                      disabled={isLoading || isSaving}
                    />
                  </FormControl>
                  <FormDescription>{config.callbackDescription}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          {showSubmitButton ? (
            <CardFooter className="flex justify-end">
              <Button type="submit" disabled={!canSubmit}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isSaving ? "Сохраняем..." : "Сохранить изменения"}
              </Button>
            </CardFooter>
          ) : null}
        </form>
      </Form>
    </Card>
  );
}

export default function AuthSettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Настройки аутентификации</h1>
        <p className="text-muted-foreground max-w-3xl">
          Управляйте входом через OAuth-провайдеров. Укажите параметры клиентов Google и Yandex, чтобы сотрудники могли
          авторизоваться по корпоративным аккаунтам. После сохранения изменения применяются сразу.
        </p>
      </div>

      <div className="space-y-6">
        {providerConfigs.map((config) => (
          <AuthProviderSettingsCard key={config.provider} config={config} />
        ))}
      </div>
    </div>
  );
}

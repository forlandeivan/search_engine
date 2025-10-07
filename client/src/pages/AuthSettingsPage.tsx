import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2, RefreshCw } from "lucide-react";

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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

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

const defaultValues: z.infer<typeof formSchema> = {
  clientId: "",
  clientSecret: "",
  callbackUrl: "/api/auth/google/callback",
  isEnabled: false,
};

type GoogleAuthProviderResponse = {
  provider: "google";
  clientId: string;
  callbackUrl: string;
  isEnabled: boolean;
  hasClientSecret: boolean;
  source: "database" | "environment";
};

export default function AuthSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery<GoogleAuthProviderResponse>({
    queryKey: ["/api/admin/auth/providers/google"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      form.reset({
        clientId: settingsQuery.data.clientId ?? "",
        clientSecret: "",
        callbackUrl: settingsQuery.data.callbackUrl ?? "/api/auth/google/callback",
        isEnabled: settingsQuery.data.isEnabled,
      });
    }
  }, [settingsQuery.data, form]);

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const trimmedClientId = values.clientId.trim();
      const trimmedCallbackUrl = values.callbackUrl.trim();
      const trimmedClientSecret = values.clientSecret?.trim();
      const hasStoredSecret = Boolean(settingsQuery.data?.hasClientSecret);

      if (values.isEnabled && trimmedClientId.length === 0) {
        form.setError("clientId", { message: "Укажите Client ID" });
        throw new Error("Заполните Client ID");
      }

      if (values.isEnabled && !hasStoredSecret && !trimmedClientSecret) {
        form.setError("clientSecret", { message: "Укажите Client Secret" });
        throw new Error("Заполните Client Secret");
      }

      const payload: Record<string, unknown> = {
        provider: "google",
        clientId: trimmedClientId,
        callbackUrl: trimmedCallbackUrl,
        isEnabled: values.isEnabled,
      };

      if (trimmedClientSecret && trimmedClientSecret.length > 0) {
        payload.clientSecret = trimmedClientSecret;
      } else if (!hasStoredSecret) {
        payload.clientSecret = "";
      }

      const response = await apiRequest("PUT", "/api/admin/auth/providers/google", payload);
      const result = (await response.json()) as GoogleAuthProviderResponse;

      queryClient.setQueryData(["/api/admin/auth/providers/google"], result);
      return result;
    },
    onSuccess: (result) => {
      form.reset({
        clientId: result.clientId,
        clientSecret: "",
        callbackUrl: result.callbackUrl,
        isEnabled: result.isEnabled,
      });

      toast({
        title: "Настройки сохранены",
        description: result.isEnabled
          ? "Вход через Google включён. Изменения применены сразу."
          : "Настройки сохранены. Вход через Google выключен.",
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
  const canSubmit = !isLoading && !isSaving;

  const infoDescription = useMemo(() => {
    if (!settingsQuery.data) {
      return "";
    }

    if (settingsQuery.data.source === "environment") {
      return "Сейчас используются переменные окружения. Сохранение формы создаст настройки в базе данных и переопределит значения окружения.";
    }

    return "Настройки хранятся в базе данных и применяются сразу после сохранения.";
  }, [settingsQuery.data]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Настройки аутентификации</h1>
        <p className="text-muted-foreground max-w-3xl">
          Управляйте входом через Google OAuth. Укажите параметры клиента, чтобы сотрудники могли входить в систему
          по корпоративной учётной записи. После сохранения настройки применяются сразу.
        </p>
      </div>

      <div className="flex items-center gap-2">
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

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle>Google OAuth</CardTitle>
          </div>
          <CardDescription>{infoDescription}</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-6">
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="isEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Включить вход через Google</FormLabel>
                      <FormDescription>
                        При включении пользователи смогут авторизоваться с помощью корпоративного аккаунта Google.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLoading || isSaving} />
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
                        placeholder="1234567890-abcdefg.apps.googleusercontent.com"
                        disabled={isLoading || isSaving}
                      />
                    </FormControl>
                    <FormDescription>
                      Укажите идентификатор OAuth-клиента из консоли Google Cloud.
                    </FormDescription>
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
                        placeholder={settingsQuery.data?.hasClientSecret ? "Секрет сохранён. Введите новый, чтобы обновить." : "Секрет OAuth-клиента"}
                        disabled={isLoading || isSaving}
                      />
                    </FormControl>
                    <FormDescription>
                      Значение хранится в зашифрованном виде и не отображается повторно. Чтобы обновить секрет, введите новое значение и сохраните настройки.
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
                        placeholder="https://app.example.com/api/auth/google/callback"
                        disabled={isLoading || isSaving}
                      />
                    </FormControl>
                    <FormDescription>
                      Путь, на который Google перенаправит пользователя после успешной аутентификации.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button type="submit" disabled={!canSubmit}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isSaving ? "Сохраняем..." : "Сохранить изменения"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}

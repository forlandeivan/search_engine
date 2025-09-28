import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Copy, UserSquare2, KeyRound, Shield } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PublicUser } from "@shared/schema";

interface UserResponse {
  user: PublicUser;
}

interface UpdateProfilePayload {
  firstName: string;
  lastName: string;
  phone: string;
}

interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

interface IssueTokenResponse {
  token: string;
  user: PublicUser;
}

interface PasswordFormValues {
  currentPassword: string;
  newPassword: string;
}

interface ProfileFormValues {
  firstName: string;
  lastName: string;
  phone: string;
}

function formatTokenDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<UserResponse>({
    queryKey: ["/api/users/me"],
  });

  const profileForm = useForm<ProfileFormValues>({
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
    },
  });

  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const user = data?.user;

  useEffect(() => {
    if (user) {
      profileForm.reset({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        phone: user.phone ?? "",
      });
      setIssuedToken(null);
    }
  }, [user, profileForm]);

  const updateProfileMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const response = await apiRequest("PATCH", "/api/users/me", values satisfies UpdateProfilePayload);
      return (await response.json()) as UserResponse;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/users/me"], result);
      queryClient.setQueryData<{ user: PublicUser } | null>(["/api/auth/session"], (prev) =>
        prev ? { ...prev, user: result.user } : prev,
      );
      toast({
        title: "Профиль обновлён",
        description: "Изменения успешно сохранены",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Не удалось обновить профиль";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (values: PasswordFormValues) => {
      const response = await apiRequest("POST", "/api/users/me/password", values satisfies ChangePasswordPayload);
      return (await response.json()) as UserResponse;
    },
    onSuccess: (result) => {
      passwordForm.reset();
      queryClient.setQueryData(["/api/users/me"], result);
      queryClient.setQueryData<{ user: PublicUser } | null>(["/api/auth/session"], (prev) =>
        prev ? { ...prev, user: result.user } : prev,
      );
      toast({
        title: "Пароль обновлён",
        description: "Новый пароль вступил в силу",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Не удалось изменить пароль";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
    },
  });

  const issueTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/users/me/api-token");
      return (await response.json()) as IssueTokenResponse;
    },
    onSuccess: (result) => {
      setIssuedToken(result.token);
      setIsCopied(false);
      queryClient.setQueryData(["/api/users/me"], { user: result.user });
      queryClient.setQueryData<{ user: PublicUser } | null>(["/api/auth/session"], (prev) =>
        prev ? { ...prev, user: result.user } : prev,
      );
      toast({
        title: "Токен выпущен",
        description: "Сохраните значение — оно отображается только один раз",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Не удалось выпустить токен";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleCopyToken = async () => {
    if (!issuedToken) {
      return;
    }

    try {
      await navigator.clipboard.writeText(issuedToken);
      setIsCopied(true);
      toast({ title: "Скопировано", description: "API токен скопирован в буфер обмена" });
    } catch (copyError) {
      const message = copyError instanceof Error ? copyError.message : "Не удалось скопировать токен";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    }
  };

  const tokenMetadata = useMemo(() => {
    if (!user) {
      return { hasToken: false, lastFour: null as string | null, generatedAt: null as string | Date | null };
    }

    return {
      hasToken: user.hasPersonalApiToken,
      lastFour: user.personalApiTokenLastFour,
      generatedAt: user.personalApiTokenGeneratedAt ?? null,
    };
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка профиля...
      </div>
    );
  }

  if (error || !user) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить данные профиля";
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-3xl font-semibold">Профиль</h1>
        <Alert variant="destructive">
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const onSubmitProfile = (values: ProfileFormValues) => {
    updateProfileMutation.mutate({
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      phone: values.phone.trim(),
    });
  };

  const onSubmitPassword = (values: PasswordFormValues) => {
    changePasswordMutation.mutate(values);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Профиль</h1>
        <p className="text-muted-foreground">
          Управляйте основными данными учётной записи и настройками безопасности.
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <UserSquare2 className="h-4 w-4" /> Основная информация
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Безопасность
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Основные данные</CardTitle>
              <CardDescription>Укажите имя, фамилию и контактный номер для внутренних уведомлений.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...profileForm}>
                <form onSubmit={profileForm.handleSubmit(onSubmitProfile)} className="space-y-6 max-w-xl">
                  <FormField
                    control={profileForm.control}
                    name="firstName"
                    rules={{ required: "Введите имя" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Имя</FormLabel>
                        <FormControl>
                          <Input placeholder="Иван" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Фамилия</FormLabel>
                        <FormControl>
                          <Input placeholder="Петров" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={profileForm.control}
                    name="phone"
                    rules={{
                      pattern: {
                        value: /^[0-9+()\s-]*$/,
                        message: "Допустимы цифры, пробелы и символы + - ( )",
                      },
                    }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Номер телефона</FormLabel>
                        <FormControl>
                          <Input placeholder="+7 900 000-00-00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={updateProfileMutation.isPending}>
                      {updateProfileMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохраняем...
                        </>
                      ) : (
                        "Сохранить"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => profileForm.reset()}
                      disabled={updateProfileMutation.isPending}
                    >
                      Сбросить
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Смена пароля</CardTitle>
              <CardDescription>Используйте сложный пароль, чтобы защитить аккаунт.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit(onSubmitPassword)} className="space-y-6 max-w-xl">
                  <FormField
                    control={passwordForm.control}
                    name="currentPassword"
                    rules={{ required: "Введите текущий пароль" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Текущий пароль</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="current-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={passwordForm.control}
                    name="newPassword"
                    rules={{ required: "Введите новый пароль", minLength: { value: 8, message: "Минимум 8 символов" } }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Новый пароль</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" disabled={changePasswordMutation.isPending}>
                    {changePasswordMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Обновляем...
                      </>
                    ) : (
                      "Изменить пароль"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" /> Персональный API токен
              </CardTitle>
              <CardDescription>
                Используйте токен в интеграциях: запросы векторного поиска и другие API будут требовать заголовок
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;token&gt;</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant={tokenMetadata.hasToken ? "default" : "secondary"} className="flex items-center gap-1">
                  {tokenMetadata.hasToken ? <Check className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {tokenMetadata.hasToken ? "Токен активен" : "Токен не выпущен"}
                </Badge>
                <span className="text-muted-foreground">
                  Последнее обновление: {formatTokenDate(tokenMetadata.generatedAt)}
                  {tokenMetadata.lastFour && tokenMetadata.hasToken ? ` · последние символы ${tokenMetadata.lastFour}` : ""}
                </span>
              </div>

              <Separator />

              {issuedToken ? (
                <Alert>
                  <AlertTitle>Новый токен</AlertTitle>
                  <AlertDescription>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <code className="rounded bg-muted px-3 py-2 text-sm break-all">{issuedToken}</code>
                      <Button type="button" variant="secondary" size="sm" onClick={handleCopyToken}>
                        {isCopied ? (
                          <>
                            <Check className="mr-2 h-4 w-4" /> Скопировано
                          </>
                        ) : (
                          <>
                            <Copy className="mr-2 h-4 w-4" /> Скопировать
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Сохраните токен — повторно он не отображается. При выпуске нового токена предыдущий станет недействительным.
                    </p>
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Нажмите кнопку ниже, чтобы сгенерировать персональный токен. Его можно использовать в сценариях интеграции и
                  векторного поиска.
                </p>
              )}

              <Button type="button" onClick={() => issueTokenMutation.mutate()} disabled={issueTokenMutation.isPending}>
                {issueTokenMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Выпускаем токен...
                  </>
                ) : (
                  "Выпустить новый токен"
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

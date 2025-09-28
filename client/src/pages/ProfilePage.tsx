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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Check, Copy, UserSquare2, KeyRound, Shield, ChevronDown, ChevronUp, History, Trash2 } from "lucide-react";
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

interface PersonalApiTokenSummary {
  id: string;
  lastFour: string;
  createdAt: string;
  revokedAt: string | null;
}

interface PersonalApiTokensResponse {
  tokens: PersonalApiTokenSummary[];
}

interface IssueTokenResponse {
  token: string;
  user: PublicUser;
  tokens: PersonalApiTokenSummary[];
}

interface RevokeTokenResponse {
  user: PublicUser;
  tokens: PersonalApiTokenSummary[];
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
  const {
    data: tokensData,
    isLoading: areTokensLoading,
    error: tokensError,
  } = useQuery<PersonalApiTokensResponse>({
    queryKey: ["/api/users/me/api-tokens"],
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
  const [showRevokedTokens, setShowRevokedTokens] = useState(false);

  const user = data?.user;
  const tokens = tokensData?.tokens ?? [];
  const activeTokens = useMemo(() => tokens.filter((token) => !token.revokedAt), [tokens]);
  const revokedTokens = useMemo(() => tokens.filter((token) => Boolean(token.revokedAt)), [tokens]);

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

  useEffect(() => {
    if (revokedTokens.length === 0) {
      setShowRevokedTokens(false);
    }
  }, [revokedTokens.length]);

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

  const issueTokenMutation = useMutation<IssueTokenResponse, unknown, void>({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/users/me/api-tokens");
      return (await response.json()) as IssueTokenResponse;
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["/api/users/me/api-tokens"], { tokens: result.tokens });
      queryClient.setQueryData(["/api/users/me"], { user: result.user });
      queryClient.setQueryData<{ user: PublicUser } | null>(["/api/auth/session"], (prev) =>
        prev ? { ...prev, user: result.user } : prev,
      );

      setIssuedToken(result.token);

      let autoCopyMessage: string | null = null;
      let isAutoCopied = false;

      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(result.token);
          isAutoCopied = true;
        } catch (copyError) {
          autoCopyMessage = copyError instanceof Error ? copyError.message : "Не удалось скопировать токен";
        }
      } else {
        autoCopyMessage = "Буфер обмена недоступен";
      }

      setIsCopied(isAutoCopied);

      toast({
        title: "Токен выпущен",
        description: isAutoCopied
          ? "Значение автоматически скопировано в буфер обмена"
          : "Сохраните значение — токен отображается только один раз",
      });

      if (autoCopyMessage && !isAutoCopied) {
        toast({
          title: "Не удалось автоматически скопировать токен",
          description: autoCopyMessage,
          variant: "destructive",
        });
      }
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

  const revokeTokenMutation = useMutation<RevokeTokenResponse, unknown, string>({
    mutationFn: async (tokenId: string) => {
      const response = await apiRequest("POST", `/api/users/me/api-tokens/${tokenId}/revoke`);
      return (await response.json()) as RevokeTokenResponse;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/users/me/api-tokens"], { tokens: result.tokens });
      queryClient.setQueryData(["/api/users/me"], { user: result.user });
      queryClient.setQueryData<{ user: PublicUser } | null>(["/api/auth/session"], (prev) =>
        prev ? { ...prev, user: result.user } : prev,
      );

      toast({
        title: "Токен отозван",
        description: "Доступ по токену будет прекращён в ближайшее время",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Не удалось отозвать токен";
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
    if (!tokensData && user) {
      return {
        hasToken: user.hasPersonalApiToken,
        lastFour: user.personalApiTokenLastFour,
        generatedAt: user.personalApiTokenGeneratedAt ?? null,
        activeCount: user.hasPersonalApiToken ? 1 : 0,
      };
    }

    const latestActive = activeTokens.length > 0 ? activeTokens[0] : null;

    return {
      hasToken: activeTokens.length > 0,
      lastFour: latestActive ? latestActive.lastFour : null,
      generatedAt: latestActive ? latestActive.createdAt : null,
      activeCount: activeTokens.length,
    };
  }, [activeTokens, tokensData, user]);

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
                  {tokenMetadata.hasToken
                    ? `Активных токенов: ${tokenMetadata.activeCount}`
                    : "Активных токенов нет"}
                </Badge>
                <span className="text-muted-foreground">
                  Последнее обновление: {formatTokenDate(tokenMetadata.generatedAt)}
                  {tokenMetadata.lastFour && tokenMetadata.hasToken ? ` · последние символы ${tokenMetadata.lastFour}` : ""}
                </span>
              </div>

              <Separator />

              {issuedToken && (
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
              )}

              {tokensError ? (
                <Alert variant="destructive">
                  <AlertTitle>Не удалось загрузить токены</AlertTitle>
                  <AlertDescription>
                    {tokensError instanceof Error
                      ? tokensError.message
                      : "Попробуйте обновить страницу чуть позже"}
                  </AlertDescription>
                </Alert>
              ) : areTokensLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаем список токенов...
                </div>
              ) : (
                <>
                  {activeTokens.length > 0 ? (
                    <ul className="space-y-3">
                      {activeTokens.map((token) => {
                        const isRevoking =
                          revokeTokenMutation.isPending && revokeTokenMutation.variables === token.id;
                        return (
                          <li key={token.id} className="rounded-md border bg-muted/20 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="space-y-1 text-sm">
                                <div className="font-medium">Последние символы {token.lastFour}</div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <History className="h-3.5 w-3.5" /> Выпущен: {formatTokenDate(token.createdAt)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => revokeTokenMutation.mutate(token.id)}
                                  disabled={isRevoking}
                                >
                                  {isRevoking ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Отзываем...
                                    </>
                                  ) : (
                                    <>
                                      <Trash2 className="mr-2 h-4 w-4" /> Отозвать
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : !issuedToken ? (
                    <p className="text-sm text-muted-foreground">
                      Нажмите кнопку ниже, чтобы сгенерировать персональный токен. Его можно использовать в сценариях
                      интеграции и векторного поиска.
                    </p>
                  ) : null}

                  {revokedTokens.length > 0 && (
                    <Collapsible open={showRevokedTokens} onOpenChange={setShowRevokedTokens}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="flex items-center gap-2 px-0">
                          {showRevokedTokens ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          Отозванные токены ({revokedTokens.length})
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-3 space-y-2">
                        {revokedTokens.map((token) => (
                          <div key={token.id} className="rounded-md border border-dashed bg-muted/10 p-3 text-sm">
                            <div className="font-medium text-muted-foreground">Последние символы {token.lastFour}</div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <History className="h-3.5 w-3.5" /> Выпущен: {formatTokenDate(token.createdAt)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Shield className="h-3.5 w-3.5" /> Отозван: {formatTokenDate(token.revokedAt ?? null)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
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

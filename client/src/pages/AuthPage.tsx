import { useEffect, useState } from "react";
import { useForm, type SubmitErrorHandler } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerUserSchema } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useMaintenanceStatus } from "@/hooks/use-maintenance-status";
import { FcGoogle } from "react-icons/fc";
import { FaYandex } from "react-icons/fa";

const loginSchema = z.object({
  email: z.string().trim().email("Введите корректный email"),
  password: z.string().min(1, "Введите пароль"),
});

type LoginValues = z.infer<typeof loginSchema>;

const extendedRegisterSchema = registerUserSchema
  .extend({
    confirmPassword: z.string().min(1, "Подтвердите пароль"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

type RegisterValues = z.infer<typeof extendedRegisterSchema>;

type AuthMode = "login" | "register";

type AuthProvidersResponse = {
  providers?: {
    local?: { enabled?: boolean };
    google?: { enabled?: boolean };
    yandex?: { enabled?: boolean };
  };
};

async function postJson<TInput extends Record<string, unknown>>(url: string, payload: TInput) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Не удалось выполнить запрос";
    const error = new Error(message) as Error & { status?: number; code?: string; raw?: unknown };
    error.status = response.status;
    error.code = typeof data?.error === "string" ? data.error : undefined;
    error.raw = data;
    throw error;
  }

  return data as unknown;
}

export default function AuthPage() {
  const maintenance = useMaintenanceStatus();
  if (maintenance.status === "active" || maintenance.status === "unknown") {
    return null;
  }

  const [mode, setMode] = useState<AuthMode>("login");
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const providersQuery = useQuery<AuthProvidersResponse>({
    queryKey: ["/api/auth/providers"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/auth/providers", { credentials: "include" });
        if (!response.ok) {
          return {
            providers: { local: { enabled: true }, google: { enabled: false }, yandex: { enabled: false } },
          };
        }

        return (await response.json()) as AuthProvidersResponse;
      } catch {
        return {
          providers: { local: { enabled: true }, google: { enabled: false }, yandex: { enabled: false } },
        };
      }
    },
    staleTime: 1000 * 60,
  });

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onChange", // Real-time validation
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(extendedRegisterSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  // Focus first invalid field on login form submit
  const focusFirstLoginError: SubmitErrorHandler<LoginValues> = (errors) => {
    const order: (keyof LoginValues)[] = ["email", "password"];
    for (const key of order) {
      if (errors[key]) {
        loginForm.setFocus(key);
        break;
      }
    }
  };

  const loginMutation = useMutation({
    mutationFn: async (values: LoginValues) => {
      // Client-side validation before API call
      const result = loginSchema.safeParse(values);
      if (!result.success) {
        throw new Error("Заполните все обязательные поля корректно");
      }
      return postJson("/api/auth/login", values);
    },
    onSuccess: async () => {
      toast({ title: "Добро пожаловать!" });
      loginForm.reset();
      setUnconfirmedEmail(null);
      setResendMessage(null);
      
      // Полностью удаляем старые данные сессии из кеша перед invalidate
      queryClient.removeQueries({ queryKey: ["/api/auth/session"] });
      
      // Принудительно обновляем сессию
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      
      // Ждем пока session query обновится
      await queryClient.refetchQueries({ queryKey: ["/api/auth/session"] });
      
      // Редиректим на главную страницу после успешного логина
      // Используем window.location для принудительного редиректа
      window.location.href = "/";
    },
    onError: (error: Error & { status?: number; code?: string }) => {
      if (error.status === 403 && error.code === "email_not_confirmed") {
        const emailValue = loginForm.getValues("email")?.trim();
        if (emailValue) {
          setUnconfirmedEmail(emailValue);
        }
        setResendMessage("Ваш e-mail ещё не подтверждён. Отправьте письмо повторно и перейдите по ссылке из письма.");
        return;
      }
      toast({
        title: "Ошибка входа",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (values: RegisterValues) => {
      const { confirmPassword, ...payload } = values;
      return postJson("/api/auth/register", payload);
    },
    onSuccess: (_, variables) => {
      setRegisterSuccess(true);
      setRegisteredEmail(variables.email.trim().toLowerCase());
      setResendCooldown(60); // Устанавливаем таймер на 60 секунд
      registerForm.reset();
    },
    onError: (error: Error) => {
      const msg = error.message;
      if (msg === "Введите корректный email" || msg === "Слишком длинный email") {
        registerForm.setError("email", { message: msg });
        return;
      }
      if (msg === "Минимум 8 символов") {
        registerForm.setError("password", { message: msg });
        return;
      }
      if (msg === "Должен содержать буквы и цифры" || msg === "Слишком длинный пароль") {
        registerForm.setError("password", { message: msg });
        return;
      }
      if (msg === "Слишком длинное имя") {
        registerForm.setError("fullName", { message: msg });
        return;
      }
      toast({
        title: "Ошибка регистрации",
        description:
          msg === "Request body is too large"
            ? "Слишком большой запрос. Попробуйте ещё раз."
            : "Ошибка сервера при регистрации. Попробуйте позже.",
        variant: "destructive",
      });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (email: string) => postJson("/api/auth/resend-confirmation", { email }),
    onSuccess: (data: unknown) => {
      const message =
        (data as { message?: string })?.message ??
        "Если этот e-mail зарегистрирован и ещё не подтверждён, мы отправили новое письмо.";
      setResendMessage(message);
      setResendCooldown(60); // Сбрасываем таймер на 60 секунд после успешной отправки
      toast({ title: "Письмо отправлено", description: message });
    },
    onError: (error: Error & { status?: number }) => {
      const msg = error.message;
      if (msg === "Слишком длинный email" || msg === "Введите корректный email") {
        loginForm.setError("email", { message: "Некорректный email" });
        setResendMessage(null);
        return;
      }
      if (msg === "Too many confirmation emails requested") {
        setResendMessage("Вы слишком часто запрашивали письмо. Попробуйте позже.");
        return;
      }
      if (msg === "Please wait before requesting another confirmation email") {
        setResendMessage("Пожалуйста, подождите немного перед повторным запросом письма.");
        return;
      }
      setResendMessage("Не удалось отправить письмо. Попробуйте позже.");
      toast({
        title: "Ошибка отправки письма",
        description:
          error.status && error.status >= 500
            ? "Не удалось отправить письмо. Попробуйте позже."
            : error.message,
        variant: "destructive",
      });
    },
  });

  const isLogin = mode === "login";
  const isGoogleEnabled = Boolean(providersQuery.data?.providers?.google?.enabled);
  const isYandexEnabled = Boolean(providersQuery.data?.providers?.yandex?.enabled);
  const showSocialLogin = isGoogleEnabled || isYandexEnabled;
  // Таймер обратного отсчета для кнопки повторной отправки
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");

    if (authError === "google" || authError === "yandex") {
      const providerLabel = authError === "google" ? "Google" : "Yandex";
      toast({
        title: `Не удалось войти через ${providerLabel}`,
        description: "Попробуйте ещё раз или используйте вход по email и паролю.",
        variant: "destructive",
      });

      params.delete("authError");
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, [toast]);

  const handleGoogleLogin = () => {
    if (!isGoogleEnabled) return;
    const redirectTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const params = new URLSearchParams();
    params.set("redirect", redirectTarget);
    window.location.href = `/api/auth/google?${params.toString()}`;
  };

  const handleYandexLogin = () => {
    if (!isYandexEnabled) return;
    const redirectTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const params = new URLSearchParams();
    params.set("redirect", redirectTarget);
    window.location.href = `/api/auth/yandex?${params.toString()}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <CardTitle className="text-2xl font-bold text-center">
            {isLogin ? "Вход в систему" : "Создание аккаунта"}
          </CardTitle>
          <CardDescription className="text-center text-base">
            {isLogin
              ? "Введите email и пароль, чтобы продолжить работу с платформой"
              : registerSuccess
                ? "Проверьте почту, чтобы завершить регистрацию"
                : "Зарегистрируйтесь, чтобы получить доступ к поисковой платформе"}
          </CardDescription>
          <div className="flex gap-2 justify-center text-sm">
            <span>{isLogin ? "Нет аккаунта?" : "Уже зарегистрированы?"}</span>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                setRegisterSuccess(false);
                setRegisteredEmail(null);
                setResendCooldown(0);
                setResendMessage(null);
                setMode(isLogin ? "register" : "login");
              }}
            >
              {isLogin ? "Создать аккаунт" : "Войти"}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {showSocialLogin && (
              <>
                <div className="space-y-3">
                  {isGoogleEnabled && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2"
                        onClick={handleGoogleLogin}
                      >
                        <FcGoogle className="h-5 w-5" />
                        {isLogin ? "Войти через Google" : "Продолжить через Google"}
                      </Button>
                    </div>
                  )}
                  {isYandexEnabled && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2"
                        onClick={handleYandexLogin}
                      >
                        <FaYandex className="h-5 w-5 text-red-500" />
                        {isLogin ? "Войти через Yandex" : "Продолжить через Yandex"}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">или</span>
                  </div>
                </div>
              </>
            )}
            {isLogin ? (
              <form
                className="space-y-4"
                onSubmit={loginForm.handleSubmit(
                  (values) => loginMutation.mutate(values),
                  focusFirstLoginError
                )}
              >
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="name@example.com"
                    aria-invalid={Boolean(loginForm.formState.errors.email)}
                    {...loginForm.register("email")}
                  />
                  {loginForm.formState.errors.email && (
                    <p className="text-sm text-destructive" role="alert">
                      {loginForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Пароль</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Введите пароль"
                    aria-invalid={Boolean(loginForm.formState.errors.password)}
                    {...loginForm.register("password")}
                  />
                  {loginForm.formState.errors.password && (
                    <p className="text-sm text-destructive" role="alert">
                      {loginForm.formState.errors.password.message}
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                  data-testid="button-login-submit"
                >
                  {loginMutation.isPending ? "Входим..." : "Войти"}
                </Button>
                {unconfirmedEmail && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2 text-sm text-amber-900">
                    <p>Ваш e-mail ещё не подтверждён. Отправьте письмо повторно и перейдите по ссылке из письма.</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs text-muted-foreground break-all">{unconfirmedEmail}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={resendMutation.isPending}
                        onClick={() => resendMutation.mutate(unconfirmedEmail)}
                      >
                        {resendMutation.isPending ? "Отправляем..." : "Отправить письмо повторно"}
                      </Button>
                    </div>
                    {resendMessage && <p className="text-xs text-muted-foreground">{resendMessage}</p>}
                  </div>
                )}
              </form>
            ) : registerSuccess ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Мы отправили письмо с подтверждением на указанный e-mail. Перейдите по ссылке в письме, чтобы
                  завершить регистрацию. После подтверждения используйте форму входа.
                </p>
                {registeredEmail && (
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-3 text-sm">
                    <div className="flex flex-col gap-2">
                      <p className="text-blue-900 font-medium">Не получили письмо?</p>
                      <p className="text-xs text-blue-700 break-all">{registeredEmail}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={resendMutation.isPending || resendCooldown > 0}
                        onClick={() => registeredEmail && resendMutation.mutate(registeredEmail)}
                      >
                        {resendMutation.isPending
                          ? "Отправляем..."
                          : resendCooldown > 0
                            ? `Отправить письмо повторно (${resendCooldown}с)`
                            : "Отправить письмо вручную"}
                      </Button>
                    </div>
                    {resendMessage && <p className="text-xs text-blue-700">{resendMessage}</p>}
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={() => {
                    setRegisterSuccess(false);
                    setRegisteredEmail(null);
                    setResendCooldown(0);
                    setResendMessage(null);
                    setMode("login");
                  }}
                >
                  Перейти ко входу
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={registerForm.handleSubmit((values) =>
                  registerMutation.mutate({
                    ...values,
                    fullName: values.fullName?.trim() || "",
                  }),
                )}
              >
                <div className="space-y-2">
                  <Label htmlFor="register-name">Имя и фамилия</Label>
                  <Input
                    id="register-name"
                    placeholder="Иван Иванов"
                    {...registerForm.register("fullName")}
                  />
                  {registerForm.formState.errors.fullName && (
                    <p className="text-sm text-destructive">{registerForm.formState.errors.fullName.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    type="email"
                    placeholder="name@example.com"
                    {...registerForm.register("email")}
                  />
                  {registerForm.formState.errors.email && (
                    <p className="text-sm text-destructive">{registerForm.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">Пароль</Label>
                  <Input
                    id="register-password"
                    type="password"
                    placeholder="Минимум 8 символов"
                    {...registerForm.register("password")}
                  />
                  {registerForm.formState.errors.password && (
                    <p className="text-sm text-destructive">{registerForm.formState.errors.password.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-confirm">Повторите пароль</Label>
                  <Input
                    id="register-confirm"
                    type="password"
                    placeholder="Повторите пароль"
                    {...registerForm.register("confirmPassword")}
                  />
                  {registerForm.formState.errors.confirmPassword && (
                    <p className="text-sm text-destructive">{registerForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
                  {registerMutation.isPending ? "Создаём аккаунт..." : "Зарегистрироваться"}
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

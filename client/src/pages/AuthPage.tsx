import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerUserSchema } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
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
  const [mode, setMode] = useState<AuthMode>("login");
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(extendedRegisterSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  const loginMutation = useMutation({
    mutationFn: (values: LoginValues) => postJson("/api/auth/login", values),
    onSuccess: async () => {
      toast({ title: "Добро пожаловать!" });
      loginForm.reset();
      setUnconfirmedEmail(null);
      setResendMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
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
    onSuccess: () => {
      setRegisterSuccess(true);
      registerForm.reset();
    },
    onError: (error: Error) => {
      const msg = error.message;
      if (msg === "Invalid email format" || msg === "Email is too long") {
        registerForm.setError("email", { message: "Некорректный email" });
        return;
      }
      if (msg === "Password is too short") {
        registerForm.setError("password", { message: "Минимум 8 символов" });
        return;
      }
      if (msg === "Invalid password format") {
        registerForm.setError("password", { message: "Пароль должен содержать буквы и цифры" });
        return;
      }
      if (msg === "Full name is too long") {
        registerForm.setError("fullName", { message: "Слишком длинное имя" });
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
      toast({ title: "Письмо отправлено", description: message });
    },
    onError: (error: Error & { status?: number }) => {
      const msg = error.message;
      if (msg === "Email is too long" || msg === "Invalid email format") {
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
                onSubmit={loginForm.handleSubmit((values) => loginMutation.mutate(values))}
              >
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="name@example.com"
                    {...loginForm.register("email")}
                  />
                  {loginForm.formState.errors.email && (
                    <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Пароль</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Введите пароль"
                    {...loginForm.register("password")}
                  />
                  {loginForm.formState.errors.password && (
                    <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
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
                <Button className="w-full" onClick={() => setMode("login")}>
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

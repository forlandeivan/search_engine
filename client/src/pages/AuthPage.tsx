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
    throw new Error(message);
  }

  return data as unknown;
}

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const providersQuery = useQuery<AuthProvidersResponse>({
    queryKey: ["/api/auth/providers"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/auth/providers", { credentials: "include" });
        if (!response.ok) {
          return { providers: { local: { enabled: true }, google: { enabled: false } } };
        }

        return (await response.json()) as AuthProvidersResponse;
      } catch {
        return { providers: { local: { enabled: true }, google: { enabled: false } } };
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
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
    },
    onError: (error: Error) => {
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
    onSuccess: async () => {
      toast({ title: "Регистрация успешна", description: "Добро пожаловать в систему" });
      registerForm.reset();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка регистрации",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isLogin = mode === "login";
  const isGoogleEnabled = Boolean(providersQuery.data?.providers?.google?.enabled);
  const isGoogleButtonDisabled = providersQuery.isLoading;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");

    if (authError === "google") {
      toast({
        title: "Не удалось войти через Google",
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
    const redirectTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const params = new URLSearchParams();
    params.set("redirect", redirectTarget);
    window.location.href = `/api/auth/google?${params.toString()}`;
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
              : "Зарегистрируйтесь, чтобы получить доступ к поисковой платформе"}
          </CardDescription>
          <div className="flex gap-2 justify-center text-sm">
            <span>{isLogin ? "Нет аккаунта?" : "Уже зарегистрированы?"}</span>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => setMode(isLogin ? "register" : "login")}
            >
              {isLogin ? "Создать аккаунт" : "Войти"}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isGoogleEnabled && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full flex items-center justify-center gap-2"
                  onClick={handleGoogleLogin}
                  disabled={isGoogleButtonDisabled}
                >
                  <FcGoogle className="h-5 w-5" />
                  {isLogin ? "Войти через Google" : "Продолжить через Google"}
                </Button>
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
                <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                  {loginMutation.isPending ? "Входим..." : "Войти"}
                </Button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={registerForm.handleSubmit((values) => registerMutation.mutate(values))}
              >
                <div className="space-y-2">
                  <Label htmlFor="register-name">Имя и фамилия</Label>
                  <Input
                    id="register-name"
                    placeholder="Иван Фролов"
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

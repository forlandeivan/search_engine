import { useState } from "react";
import { useForm, type SubmitErrorHandler } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { z } from "zod";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
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
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Building2 } from "lucide-react";
import type { SessionResponse } from "@/types/session";

// ============================================================================
// Types
// ============================================================================

interface InvitationInfo {
  valid: boolean;
  error?: string;
  invitation?: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  };
  workspace?: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
  invitedBy?: {
    fullName: string | null;
    email: string;
  } | null;
  userExists?: boolean;
}

interface AcceptInviteResponse {
  success: boolean;
  workspace: {
    id: string;
    role: string;
  };
}

// ============================================================================
// Validation Schemas
// ============================================================================

const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Введите имя").max(255),
  password: z
    .string()
    .min(8, "Минимум 8 символов")
    .max(100)
    .refine(
      (p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p),
      "Должен содержать буквы и цифры",
    ),
  confirmPassword: z.string().min(1, "Подтвердите пароль"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

type RegisterFormValues = z.infer<typeof registerSchema>;

const loginSchema = z.object({
  password: z.string().min(1, "Введите пароль"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ============================================================================
// Error Messages
// ============================================================================

const errorMessages: Record<string, string> = {
  INVALID_TOKEN: "Ссылка приглашения недействительна",
  EXPIRED: "Срок действия приглашения истёк",
  CANCELLED: "Приглашение было отменено",
  ALREADY_ACCEPTED: "Приглашение уже использовано",
  EMAIL_MISMATCH: "Email вашего аккаунта не совпадает с email приглашения",
  ALREADY_MEMBER: "Вы уже являетесь участником этого рабочего пространства",
  USER_EXISTS: "Пользователь с таким email уже существует",
};

// ============================================================================
// Component
// ============================================================================

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check if user is logged in
  const sessionQuery = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
    staleTime: 0,
  });

  const currentUser = sessionQuery.data?.user;

  // Fetch invitation info
  const invitationQuery = useQuery({
    queryKey: ["/api/auth/invite", token],
    queryFn: async () => {
      const res = await fetch(`/api/auth/invite/${token}`);
      if (!res.ok) {
        throw new Error("Failed to fetch invitation");
      }
      return res.json() as Promise<InvitationInfo>;
    },
    enabled: !!token,
    staleTime: 0,
  });

  // Accept invitation (for logged-in user)
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/accept-invite", { token });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Не удалось принять приглашение");
      }
      return res.json() as Promise<AcceptInviteResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      toast({ title: "Приглашение принято" });
      navigate("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Complete registration via invitation
  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onChange",
    defaultValues: { fullName: "", password: "", confirmPassword: "" },
  });

  const registerMutation = useMutation({
    mutationFn: async (values: RegisterFormValues) => {
      // Дополнительная проверка на клиенте перед отправкой
      const result = registerSchema.safeParse(values);
      if (!result.success) {
        throw new Error("Заполните все обязательные поля корректно");
      }

      const res = await apiRequest("POST", "/api/auth/complete-invite", {
        token,
        password: values.password,
        fullName: values.fullName,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Не удалось создать аккаунт");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      toast({ title: "Аккаунт создан" });
      navigate("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Login form (for existing user)
  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const email = invitationQuery.data?.invitation?.email;
      const res = await apiRequest("POST", "/api/auth/login", {
        email,
        password: values.password,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Неверный пароль");
      }
      return res.json();
    },
    onSuccess: async () => {
      // After login, accept the invitation
      await acceptMutation.mutateAsync();
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка входа",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const focusFirstRegisterError: SubmitErrorHandler<RegisterFormValues> = (errors) => {
    const order: (keyof RegisterFormValues)[] = ["fullName", "password", "confirmPassword"];
    for (const key of order) {
      if (errors[key]) {
        registerForm.setFocus(key);
        break;
      }
    }
  };

  // ============================================================================
  // Render States
  // ============================================================================

  // Loading
  if (invitationQuery.isLoading || sessionQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Проверяем приглашение...</p>
        </div>
      </div>
    );
  }

  const invitation = invitationQuery.data;

  // Invalid token
  if (!invitation?.valid) {
    const errorMessage = errorMessages[invitation?.error ?? "INVALID_TOKEN"] || "Недействительная ссылка";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Приглашение недействительно</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => navigate("/")}>
              Перейти на главную
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { workspace, invitedBy, userExists } = invitation;

  // User is logged in
  if (currentUser) {
    const emailMatch = currentUser.email.toLowerCase() === invitation.invitation?.email.toLowerCase();

    if (!emailMatch) {
      // Email mismatch
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <WorkspaceInfo workspace={workspace} invitedBy={invitedBy} />
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>
                  Приглашение отправлено на <strong>{invitation.invitation?.email}</strong>, 
                  но вы вошли как <strong>{currentUser.email}</strong>.
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate("/")}
                >
                  Отмена
                </Button>
                <Button
                  className="flex-1"
                  onClick={async () => {
                    await apiRequest("POST", "/api/auth/logout");
                    queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
                  }}
                >
                  Выйти и войти под другим аккаунтом
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Email matches - can accept
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <WorkspaceInfo workspace={workspace} invitedBy={invitedBy} />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Вы приглашены в рабочее пространство с ролью: <strong>{invitation.invitation?.role}</strong>
            </p>
            <Button
              className="w-full"
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending}
            >
              {acceptMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Принять приглашение
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User not logged in, but account exists
  if (userExists) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <WorkspaceInfo workspace={workspace} invitedBy={invitedBy} />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              У вас уже есть аккаунт. Войдите, чтобы принять приглашение.
            </p>
            <form
              onSubmit={loginForm.handleSubmit((v) => loginMutation.mutate(v))}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={invitation.invitation?.email ?? ""}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  {...loginForm.register("password")}
                  disabled={loginMutation.isPending}
                aria-invalid={loginForm.formState.errors.password ? "true" : "false"}
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
                disabled={loginMutation.isPending || acceptMutation.isPending}
              >
                {(loginMutation.isPending || acceptMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Войти и принять приглашение
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // New user - registration form
  const showRegisterSummary =
    registerForm.formState.submitCount > 0 &&
    Object.keys(registerForm.formState.errors).length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <WorkspaceInfo workspace={workspace} invitedBy={invitedBy} />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Создайте аккаунт, чтобы присоединиться к рабочему пространству.
          </p>
          {showRegisterSummary ? (
            <Alert>
              <AlertDescription>
                Заполните обязательные поля и исправьте ошибки ниже.
              </AlertDescription>
            </Alert>
          ) : null}
          <form
            onSubmit={registerForm.handleSubmit(
              (v) => registerMutation.mutate(v),
              focusFirstRegisterError,
            )}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={invitation.invitation?.email ?? ""}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Имя</Label>
              <Input
                id="fullName"
                {...registerForm.register("fullName")}
                placeholder="Иван Иванов"
                disabled={registerMutation.isPending}
                aria-invalid={registerForm.formState.errors.fullName ? "true" : "false"}
              />
              {registerForm.formState.errors.fullName && (
                <p className="text-sm text-destructive" role="alert">
                  {registerForm.formState.errors.fullName.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                {...registerForm.register("password")}
                placeholder="Минимум 8 символов"
                disabled={registerMutation.isPending}
                aria-invalid={registerForm.formState.errors.password ? "true" : "false"}
              />
              {registerForm.formState.errors.password && (
                <p className="text-sm text-destructive" role="alert">
                  {registerForm.formState.errors.password.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Подтверждение пароля</Label>
              <Input
                id="confirmPassword"
                type="password"
                {...registerForm.register("confirmPassword")}
                disabled={registerMutation.isPending}
                aria-invalid={registerForm.formState.errors.confirmPassword ? "true" : "false"}
              />
              {registerForm.formState.errors.confirmPassword && (
                <p className="text-sm text-destructive" role="alert">
                  {registerForm.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Создать аккаунт и присоединиться
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface WorkspaceInfoProps {
  workspace?: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
  invitedBy?: {
    fullName: string | null;
    email: string;
  } | null;
}

function WorkspaceInfo({ workspace, invitedBy }: WorkspaceInfoProps) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
        {workspace?.iconUrl ? (
          <img
            src={workspace.iconUrl}
            alt={workspace.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Building2 className="h-8 w-8 text-primary" />
        )}
      </div>
      <CardTitle className="mb-2">{workspace?.name ?? "Рабочее пространство"}</CardTitle>
      {invitedBy && (
        <CardDescription>
          Приглашение от {invitedBy.fullName || invitedBy.email}
        </CardDescription>
      )}
    </div>
  );
}

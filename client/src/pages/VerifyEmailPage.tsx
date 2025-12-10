import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";

type VerifyState = "loading" | "success" | "invalid" | "used" | "server" | "missing";

async function postVerifyEmail(token: string) {
  const response = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Internal server error";
    const error = new Error(message);
    // @ts-expect-error custom status
    error.status = response.status;
    throw error;
  }

  return data as { message?: string };
}

export default function VerifyEmailPage() {
  const [state, setState] = useState<VerifyState>("loading");
  const [resendEmail, setResendEmail] = useState("");
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token")?.trim() ?? "";
  }, []);

  useEffect(() => {
    if (!token) {
      setState("missing");
      return;
    }

    let isActive = true;
    setState("loading");

    postVerifyEmail(token)
      .then(() => {
        if (isActive) {
          setState("success");
        }
      })
      .catch((error: Error & { status?: number }) => {
        if (!isActive) return;
        const msg = error.message;
        if (msg === "Invalid or expired token") {
          setState("invalid");
          return;
        }
        if (msg === "Token already used") {
          setState("used");
          return;
        }
        setState("server");
      });

    return () => {
      isActive = false;
    };
  }, [token]);

  const renderIcon = () => {
    if (state === "success") {
      return <CheckCircle className="h-10 w-10 text-green-500" />;
    }
    if (state === "loading") {
      return <Loader2 className="h-10 w-10 text-primary animate-spin" />;
    }
    return <AlertCircle className="h-10 w-10 text-amber-500" />;
  };

  const titleMap: Record<VerifyState, string> = {
    loading: "Подтверждаем e-mail…",
    success: "E-mail успешно подтверждён",
    invalid: "Ссылка недействительна или устарела",
    used: "Ссылка уже использована",
    server: "Ошибка при подтверждении",
    missing: "Некорректная ссылка",
  };

  const descriptionMap: Record<VerifyState, string> = {
    loading: "Подождите, мы проверяем ссылку подтверждения.",
    success: "Теперь вы можете войти в систему, используя свой e-mail и пароль.",
    invalid: "Ссылка недействительна или устарела. Запросите новое письмо с подтверждением.",
    used: "Эта ссылка уже была использована. Попробуйте войти или отправьте письмо повторно.",
    server: "Произошла ошибка на сервере. Попробуйте позже.",
    missing: "В ссылке отсутствует токен подтверждения. Проверьте письмо или запросите новое.",
  };

  const canResend = state === "invalid" || state === "used" || state === "missing";

  const handleResend = async () => {
    if (!resendEmail.trim()) {
      setResendStatus("Введите корректный e-mail для повторной отправки.");
      return;
    }
    setResendStatus(null);
    setResendLoading(true);
    try {
      const resp = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: resendEmail.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = typeof data?.message === "string" ? data.message : "Не удалось отправить письмо";
        setResendStatus(
          msg === "Too many confirmation emails requested"
            ? "Вы слишком часто запрашивали письмо. Попробуйте позже."
            : msg === "Please wait before requesting another confirmation email"
              ? "Пожалуйста, подождите немного перед повторным запросом."
              : msg === "Invalid email format" || msg === "Email is too long"
                ? "Некорректный e-mail"
                : "Не удалось отправить письмо. Попробуйте позже.",
        );
        return;
      }
      const message: string =
        typeof data?.message === "string"
          ? data.message
          : "Если этот e-mail зарегистрирован и ещё не подтверждён, мы отправили новое письмо.";
      setResendStatus(message);
    } catch {
      setResendStatus("Не удалось отправить письмо. Попробуйте позже.");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">{renderIcon()}</div>
          <CardTitle className="text-2xl font-bold">{titleMap[state]}</CardTitle>
          <CardDescription className="text-base">{descriptionMap[state]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state === "loading" ? (
            <Button className="w-full" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Проверяем…
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href="/auth/login">Перейти ко входу</Link>
              </Button>
              {canResend && (
                <div className="space-y-2 border rounded-md p-3">
                  <p className="text-sm text-muted-foreground">Нужно новое письмо? Укажите свой e-mail:</p>
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    disabled={resendLoading}
                  />
                  <Button variant="outline" className="w-full" onClick={handleResend} disabled={resendLoading}>
                    {resendLoading ? "Отправляем..." : "Отправить письмо повторно"}
                  </Button>
                  {resendStatus && <p className="text-xs text-muted-foreground">{resendStatus}</p>}
                </div>
              )}
              {(state === "invalid" || state === "used" || state === "missing") && (
                <p className="text-sm text-muted-foreground text-center">
                  Если письмо потерялось, запросите новую ссылку подтверждения на странице входа.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

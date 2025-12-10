import nodemailer from "nodemailer";

import { EmailSender, EmailMessage, EmailValidationError, validateEmailMessage } from "./email";
import { smtpSettingsService } from "./smtp-settings";
import { systemNotificationLogService } from "./system-notification-log-service";
import { SystemEmailType } from "./email";

export class SmtpSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpSendError";
  }
}

export class SmtpEmailSender implements EmailSender {
  constructor(private readonly settings = smtpSettingsService) {}

  async sendEmail(message: EmailMessage, signal?: AbortSignal): Promise<void> {
    // Валидация тела письма
    validateEmailMessage(message);

    // Получаем настройки SMTP
    const settings = await this.settings.getSettingsWithSecret();
    if (!settings || !settings.host || !settings.port || !settings.fromEmail) {
      throw new SmtpSendError("SMTP settings are not configured");
    }
    if (settings.useTls && settings.useSsl) {
      throw new EmailValidationError("TLS and SSL cannot be enabled at the same time");
    }

    const secure = Boolean(settings.useSsl);
    const requireTLS = Boolean(settings.useTls) && !secure;
    const auth =
      settings.username && settings.password
        ? {
            user: settings.username,
            pass: settings.password,
          }
        : undefined;

    const from = settings.fromName ? `${settings.fromName} <${settings.fromEmail}>` : settings.fromEmail;

    // Таймауты на уровне транспорта
    const transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure,
      requireTLS,
      auth,
      connectionTimeout: 30_000,
      socketTimeout: 30_000,
    });

    // Контроль отмены/таймаута через внешний signal
    const controller = new AbortController();
    const timers: NodeJS.Timeout[] = [];
    timers.push(
      setTimeout(() => controller.abort(), 30_000),
    );
    const combinedSignal =
      signal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;

    if (combinedSignal.aborted) {
      throw new SmtpSendError("SMTP send timeout");
    }

    const shouldLog = Boolean(message.isSystemMessage || message.type);
    const type = normalizeType(message.type);
    const toEmail = message.to[0];
    const preview = buildPreview(message);
    const bodyForLog = message.bodyHtml ?? message.bodyText ?? "";

    let logId: string | null = null;
    if (shouldLog) {
      try {
        const log = await systemNotificationLogService.createLog({
          type,
          toEmail,
          subject: message.subject,
          body: bodyForLog,
          bodyPreview: preview,
          status: "queued",
          triggeredByUserId: message.triggeredByUserId ?? null,
          correlationId: message.correlationId ?? null,
        });
        logId = log.id;
      } catch (err) {
        console.error("[email-log] create failed", {
          error: err instanceof Error ? err.message : String(err),
          type,
          to: toEmail,
        });
      }
    }

    try {
      const info = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.bodyHtml,
        text: message.bodyText ?? undefined,
      });
      if (logId) {
        await systemNotificationLogService.markSent(logId, {
          sentAt: new Date(),
          smtpResponse: typeof info?.response === "string" ? info.response : null,
        });
      }
      console.info("[email] sent", {
        type,
        system: Boolean(message.isSystemMessage),
        to: message.to,
        logId,
      });
    } catch (err) {
      const safeMessage = normalizeSmtpError(err);
      if (logId) {
        try {
          await systemNotificationLogService.markFailed(logId, {
            errorMessage: safeMessage,
            smtpResponse: err instanceof Error ? err.message : String(err),
          });
        } catch (logErr) {
          console.error("[email-log] mark failed", {
            error: logErr instanceof Error ? logErr.message : String(logErr),
            logId,
          });
        }
      }
      console.error("[smtp-email] send failed", {
        to: message.to,
        subject: message.subject,
        error: safeMessage,
        type,
        system: Boolean(message.isSystemMessage),
      });
      throw new SmtpSendError(safeMessage);
    } finally {
      timers.forEach(clearTimeout);
    }
  }
}

function normalizeSmtpError(err: unknown): string {
  const text = err instanceof Error ? (err.message || "").toLowerCase() : "";

  if (text.includes("timeout") || text.includes("timed out") || text.includes("ETIME")) {
    return "SMTP send timeout";
  }
  if (text.includes("auth") || text.includes("login") || text.includes("credentials")) {
    return "Invalid SMTP credentials";
  }
  if (text.includes("self signed") || text.includes("certificate") || text.includes("tls") || text.includes("ssl")) {
    return "SMTP TLS/SSL error";
  }
  if (text.includes("enotfound") || text.includes("econnrefused") || text.includes("connect") || text.includes("dns")) {
    return "SMTP connection error";
  }
  if (text.includes("not configured")) {
    return "SMTP settings are not configured";
  }

  return "SMTP send failed";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildPreview(message: EmailMessage): string | null {
  if (message.bodyText && message.bodyText.trim().length > 0) {
    return message.bodyText.trim();
  }
  if (message.bodyHtml) {
    return stripHtml(message.bodyHtml);
  }
  return null;
}

function normalizeType(type?: SystemEmailType | string): string {
  if (!type) return "system_email";
  if (typeof type === "string") {
    switch (type) {
      case SystemEmailType.RegistrationConfirmation:
        return "registration_confirmation";
      case SystemEmailType.PasswordReset:
        return "password_reset";
      default:
        return type;
    }
  }
  return "system_email";
}

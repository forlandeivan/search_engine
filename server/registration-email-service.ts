import type { EmailSender, EmailMessage } from "./email";
import { EmailValidationError, SystemEmailType } from "./email";

export interface RegistrationEmailService {
  sendRegistrationConfirmationEmail(
    userEmail: string,
    userDisplayName: string | null,
    confirmationLink: string,
    signal?: AbortSignal,
  ): Promise<void>;
}

const DEFAULT_PRODUCT_NAME = "Unica";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

function isValidUrl(link: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(link);
    return true;
  } catch {
    return false;
  }
}

export class RegistrationEmailServiceImpl implements RegistrationEmailService {
  constructor(
    private readonly emailSender: EmailSender,
    private readonly productName: string = DEFAULT_PRODUCT_NAME,
  ) {}

  async sendRegistrationConfirmationEmail(
    userEmail: string,
    userDisplayName: string | null,
    confirmationLink: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const recipient = userEmail?.trim();
    if (!recipient || !isValidEmail(recipient)) {
      throw new EmailValidationError("Invalid recipient email");
    }
    if (!confirmationLink?.trim() || !isValidUrl(confirmationLink)) {
      throw new EmailValidationError("Invalid confirmation link");
    }

    const displayName = userDisplayName?.trim() || recipient;
    const subject = `Подтверждение регистрации в ${this.productName}`;

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937; font-size: 16px;">
        <p>Здравствуйте, ${escapeHtml(displayName)}!</p>
        <p>Вы получили это письмо, потому что зарегистрировались в ${escapeHtml(this.productName)}.</p>
        <p>Для подтверждения учётной записи нажмите кнопку ниже:</p>
        <p style="margin: 24px 0;">
          <a href="${escapeAttribute(confirmationLink)}" style="
            display: inline-block;
            padding: 12px 20px;
            background: #2563eb;
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
          ">Подтвердить регистрацию</a>
        </p>
        <p>Ссылка действует 24 часа. Если вы не регистрировались, просто проигнорируйте это письмо.</p>
        <p style="color: #6b7280; font-size: 14px;">Если кнопка не работает, скопируйте и вставьте ссылку в браузер:<br/>
        <a href="${escapeAttribute(confirmationLink)}">${escapeHtml(confirmationLink)}</a></p>
      </div>
    `;

    const bodyText =
      `Здравствуйте, ${displayName}!\n\n` +
      `Вы получили это письмо, потому что зарегистрировались в ${this.productName}.\n` +
      `Для подтверждения учетной записи перейдите по ссылке (действует 24 часа):\n` +
      `${confirmationLink}\n\n` +
      `Если вы не регистрировались, просто игнорируйте это письмо.`;

    const message: EmailMessage = {
      to: [recipient],
      subject,
      bodyHtml,
      bodyText,
      isSystemMessage: true,
      type: SystemEmailType.RegistrationConfirmation,
    };

    // Логируем без чувствительных данных (без ссылки целиком)
    try {
      await this.emailSender.sendEmail(message, signal);
      console.info("[email] RegistrationConfirmation sent", {
        to: recipient,
        product: this.productName,
        type: message.type,
      });
    } catch (err) {
      console.error("[email] RegistrationConfirmation failed", {
        to: recipient,
        product: this.productName,
        type: message.type,
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        fullError: err,
      });
      throw err;
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

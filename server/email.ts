import { Buffer } from "buffer";

export type EmailMessage = {
  to: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  isSystemMessage?: boolean;
  type?: SystemEmailType;
  triggeredByUserId?: string | null;
  correlationId?: string | null;
};

export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailValidationError";
  }
}

export interface EmailSender {
  sendEmail(message: EmailMessage, signal?: AbortSignal): Promise<void>;
}

export enum SystemEmailType {
  RegistrationConfirmation = "RegistrationConfirmation",
  PasswordReset = "PasswordReset",
  WorkspaceInvitation = "WorkspaceInvitation",
  WorkspaceMemberAdded = "WorkspaceMemberAdded",
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;
const MAX_SUBJECT_LENGTH = 255;
const MAX_BODY_BYTES = 100 * 1024;

export function validateEmailMessage(message: EmailMessage): void {
  if (!message?.to || message.to.length === 0) {
    throw new EmailValidationError("At least one recipient is required");
  }
  if (message.to.length > MAX_RECIPIENTS) {
    throw new EmailValidationError("Too many recipients");
  }
  for (const recipient of message.to) {
    if (typeof recipient !== "string" || !EMAIL_PATTERN.test(recipient.trim())) {
      throw new EmailValidationError("Invalid recipient email");
    }
  }

  const subject = message.subject ?? "";
  if (!subject.trim()) {
    throw new EmailValidationError("Subject is required");
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new EmailValidationError("Subject is too long");
  }

  const html = message.bodyHtml ?? "";
  if (!html.trim()) {
    throw new EmailValidationError("Email body is required");
  }

  const htmlSize = Buffer.byteLength(html, "utf8");
  const textSize = message.bodyText ? Buffer.byteLength(message.bodyText, "utf8") : 0;
  if (htmlSize + textSize > MAX_BODY_BYTES) {
    throw new EmailValidationError("Email body size exceeds 100 KB");
  }
}

/**
 * Stub sender that только валидирует сообщение.
 * Реальная отправка (SMTP и т.п.) будет добавлена на следующих шагах.
 */
export class NoopEmailSender implements EmailSender {
  async sendEmail(message: EmailMessage, _signal?: AbortSignal): Promise<void> {
    validateEmailMessage(message);
    // No-op: delivery will be implemented later.
  }
}

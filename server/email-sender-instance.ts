import type { EmailSender } from "./email";
import { SmtpEmailSender } from "./smtp-email-sender";
import { smtpSettingsService } from "./smtp-settings";

export const emailSender: EmailSender = new SmtpEmailSender(smtpSettingsService);

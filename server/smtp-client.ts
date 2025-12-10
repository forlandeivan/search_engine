import nodemailer from "nodemailer";

export type SmtpSendConfig = {
  host: string;
  port: number;
  useTls: boolean;
  useSsl: boolean;
  username: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
};

export type SendTestEmailOptions = {
  to: string;
  timeoutMs?: number;
};

export class SmtpClient {
  async sendTestEmail(config: SmtpSendConfig, options: SendTestEmailOptions): Promise<void> {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useSsl,
      requireTLS: config.useTls,
      auth:
        config.username && config.password
          ? {
              user: config.username,
              pass: config.password,
            }
          : undefined,
      connectionTimeout: options.timeoutMs ?? 30000,
      greetingTimeout: options.timeoutMs ?? 30000,
      socketTimeout: options.timeoutMs ?? 30000,
    });

    const fromHeader = config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;

    await transport.sendMail({
      from: fromHeader,
      to: options.to,
      subject: "SMTP test email",
      text: "Тестовое письмо SMTP. Если вы это видите, настройки работают.",
    });
  }
}

export const smtpClient = new SmtpClient();

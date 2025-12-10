import { smtpClient, type SmtpSendConfig } from "./smtp-client";
import { smtpSettingsService, SmtpSettingsError } from "./smtp-settings";
import { SmtpSettings } from "@shared/schema";

function basicEmailValidate(email: string): boolean {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email.trim());
}

export class SmtpTestService {
  constructor(private readonly client = smtpClient) {}

  private buildConfig(settings: SmtpSettings): SmtpSendConfig {
    if (!settings.host || !settings.port || !settings.fromEmail) {
      throw new SmtpSettingsError("SMTP settings are not configured");
    }
    if (settings.useSsl && settings.useTls) {
      throw new SmtpSettingsError("TLS and SSL cannot be enabled at the same time");
    }
    return {
      host: settings.host,
      port: settings.port,
      useTls: settings.useTls,
      useSsl: settings.useSsl,
      username: settings.username ?? null,
      password: settings.password ?? null,
      fromEmail: settings.fromEmail,
      fromName: settings.fromName ?? null,
    };
  }

  async sendTestEmail(testEmail: string): Promise<void> {
    const email = testEmail?.trim();
    if (!email || !basicEmailValidate(email) || email.length > 255) {
      throw new SmtpSettingsError("Invalid test email");
    }

    const settings = await smtpSettingsService.getSettingsWithSecret();
    if (!settings) {
      throw new SmtpSettingsError("SMTP settings are not configured");
    }

    const config = this.buildConfig(settings);
    if (config.useSsl && config.useTls) {
      throw new SmtpSettingsError("TLS and SSL cannot be enabled at the same time");
    }

    await this.client.sendTestEmail(config, { to: email, timeoutMs: 30000 });
  }
}

export const smtpTestService = new SmtpTestService();

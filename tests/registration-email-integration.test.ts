import { describe, it, expect, vi } from "vitest";
import { RegistrationEmailServiceImpl } from "../server/registration-email-service";
import { SmtpEmailSender, SmtpSendError } from "../server/smtp-email-sender";

// Интеграционный тест уровня сервиса: подменяем SMTP-настройки и SMTP-клиент.
const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
  createTransport: vi.fn(() => ({
    sendMail: sendMailMock,
  })),
}));

describe("RegistrationEmailService integration (SMTP settings stub)", () => {
  it("fails when SMTP settings are missing", async () => {
    const sender = new SmtpEmailSender({
      getSettingsWithSecret: async () => null,
    } as any);
    const service = new RegistrationEmailServiceImpl(sender, "UnicaTest");

    await expect(
      service.sendRegistrationConfirmationEmail(
        "user@example.com",
        "User",
        "https://app.example.com/confirm",
      ),
    ).rejects.toThrowError(new SmtpSendError("SMTP settings are not configured"));
  });

  it("invokes email sender when settings are present", async () => {
    sendMailMock.mockResolvedValueOnce({});

    const sender = new SmtpEmailSender({
      getSettingsWithSecret: async () => ({
        host: "smtp.example.com",
        port: 587,
        useTls: true,
        useSsl: false,
        username: "user",
        password: "pass",
        fromEmail: "noreply@example.com",
        fromName: "App",
        updatedByAdminId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: "smtp_singleton",
      }),
    } as any);
    const service = new RegistrationEmailServiceImpl(sender, "UnicaTest");

    await service.sendRegistrationConfirmationEmail(
      "user@example.com",
      "User",
      "https://app.example.com/confirm",
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toEqual(["user@example.com"]);
    expect(args.subject).toContain("Подтверждение регистрации");
  });
});

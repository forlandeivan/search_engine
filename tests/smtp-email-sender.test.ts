import { describe, it, expect, vi, beforeEach } from "vitest";
import { SmtpEmailSender, SmtpSendError } from "../server/smtp-email-sender";
import { EmailValidationError } from "../server/email";

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

describe("SmtpEmailSender", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
  });

  const validMessage = {
    to: ["user@example.com"],
    subject: "Test",
    bodyHtml: "<p>Hello</p>",
    bodyText: "Hello",
    isSystemMessage: true,
  };

  it("throws when settings are missing", async () => {
    const sender = new SmtpEmailSender({
      getSettingsWithSecret: async () => null,
    } as any);

    await expect(sender.sendEmail(validMessage)).rejects.toThrowError(new SmtpSendError("SMTP settings are not configured"));
  });

  it("throws when TLS and SSL are both enabled", async () => {
    const sender = new SmtpEmailSender({
      getSettingsWithSecret: async () => ({
        host: "smtp.example.com",
        port: 587,
        useTls: true,
        useSsl: true,
        username: null,
        password: null,
        fromEmail: "noreply@example.com",
        fromName: "App",
        updatedByAdminId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        id: "smtp_singleton",
      }),
    } as any);

    await expect(sender.sendEmail(validMessage)).rejects.toThrowError(EmailValidationError);
  });

  it("sends email with correct payload", async () => {
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

    await sender.sendEmail(validMessage);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toEqual(validMessage.to);
    expect(args.subject).toEqual(validMessage.subject);
    expect(args.html).toEqual(validMessage.bodyHtml);
    expect(args.text).toEqual(validMessage.bodyText);
    expect(args.from).toContain("noreply@example.com");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistrationEmailServiceImpl } from "../server/registration-email-service";
import { EmailValidationError } from "../server/email";

const sendEmailMock = vi.fn();

describe("RegistrationEmailService", () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
  });

  const service = new RegistrationEmailServiceImpl(
    { sendEmail: sendEmailMock } as any,
    "UnicaTest",
  );

  it("sends email with expected fields", async () => {
    sendEmailMock.mockResolvedValueOnce(undefined);
    await service.sendRegistrationConfirmationEmail(
      "user@example.com",
      "User",
      "https://app.example.com/confirm?token=abc",
    );

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const message = sendEmailMock.mock.calls[0][0];
    expect(message.to).toEqual(["user@example.com"]);
    expect(message.subject).toBe("Подтверждение регистрации в UnicaTest");
    expect(message.isSystemMessage).toBe(true);
    expect(message.type).toBe("RegistrationConfirmation");
    expect(message.bodyHtml).toContain("https://app.example.com/confirm?token=abc");
    expect(message.bodyHtml).toContain("Ссылка действует 24 часа");
  });

  it("throws on invalid email", async () => {
    await expect(
      service.sendRegistrationConfirmationEmail(
        "bad-email",
        "User",
        "https://app.example.com/confirm",
      ),
    ).rejects.toThrowError(EmailValidationError);
  });

  it("throws on invalid link", async () => {
    await expect(
      service.sendRegistrationConfirmationEmail(
        "user@example.com",
        "User",
        "not-a-url",
      ),
    ).rejects.toThrowError(EmailValidationError);
  });
});

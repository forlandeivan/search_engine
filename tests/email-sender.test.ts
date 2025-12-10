import { describe, it, expect } from "vitest";
import { EmailValidationError, validateEmailMessage, NoopEmailSender } from "../server/email";

describe("Email validation", () => {
  const baseMessage = {
    to: ["user@example.com"],
    subject: "Hello",
    bodyHtml: "<p>Hi</p>",
    bodyText: "Hi",
    isSystemMessage: true,
  };

  it("passes for a valid message", async () => {
    const sender = new NoopEmailSender();
    await expect(sender.sendEmail(baseMessage)).resolves.toBeUndefined();
  });

  it("fails for too many recipients", () => {
    const msg = { ...baseMessage, to: Array.from({ length: 11 }, (_, i) => `u${i}@ex.com`) };
    expect(() => validateEmailMessage(msg)).toThrowError(new EmailValidationError("Too many recipients"));
  });

  it("fails for invalid recipient", () => {
    const msg = { ...baseMessage, to: ["bad-email"] };
    expect(() => validateEmailMessage(msg)).toThrowError(EmailValidationError);
  });

  it("fails for long subject", () => {
    const msg = { ...baseMessage, subject: "a".repeat(256) };
    expect(() => validateEmailMessage(msg)).toThrowError(new EmailValidationError("Subject is too long"));
  });

  it("fails for oversized body", () => {
    const big = "a".repeat(101 * 1024);
    const msg = { ...baseMessage, bodyHtml: big, bodyText: undefined };
    expect(() => validateEmailMessage(msg)).toThrowError(new EmailValidationError("Email body size exceeds 100 KB"));
  });
});

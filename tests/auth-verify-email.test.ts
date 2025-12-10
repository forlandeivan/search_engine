import { describe, it, expect, beforeEach, vi } from "vitest";
import { storage } from "../server/storage";
import { emailConfirmationTokenService } from "../server/email-confirmation-token-service";
import { registrationEmailService } from "../server/email-sender-registry";
import request from "supertest";
import appFactory from "../server/index";

vi.mock("../server/email-sender-registry", () => ({
  registrationEmailService: {
    sendRegistrationConfirmationEmail: vi.fn(),
  },
}));

describe("POST /api/auth/verify-email", () => {
  const server = appFactory;

  beforeEach(async () => {
    // Clean tokens table between tests if needed (simplified)
    await storage.db.execute(`DELETE FROM email_confirmation_tokens`);
    await storage.db.execute(`DELETE FROM users WHERE email LIKE 'verify-test-%'`);
  });

  it("confirms email with valid token", async () => {
    const user = await storage.createUser({
      email: "verify-test@example.com",
      fullName: "Test User",
      firstName: "Test",
      lastName: "User",
      phone: "",
      passwordHash: "hash",
      isEmailConfirmed: false,
      status: "pending_email_confirmation",
      emailConfirmedAt: null,
    });

    const token = await emailConfirmationTokenService.createToken(user.id, 24);

    const res = await request(server).post("/api/auth/verify-email").send({ token });
    expect(res.status).toBe(200);
    expect(res.body?.message).toBe("Email has been successfully confirmed.");

    const updated = await storage.getUserById(user.id);
    expect(updated?.isEmailConfirmed).toBe(true);
    expect(updated?.status).toBe("active");
  });

  it("returns 400 for expired or missing token", async () => {
    const res = await request(server).post("/api/auth/verify-email").send({ token: "bad-token" });
    expect(res.status).toBe(400);
    expect(res.body?.message).toBe("Invalid or expired token");
  });
});

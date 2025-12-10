import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import appFactory from "../server/index";
import { storage } from "../server/storage";
import bcrypt from "bcryptjs";

describe("POST /api/auth/login email confirmation guard", () => {
  const server = appFactory;

  beforeEach(async () => {
    await storage.db.execute(`DELETE FROM email_confirmation_tokens`);
    await storage.db.execute(`DELETE FROM users WHERE email LIKE 'login-test-%'`);
  });

  it("denies login for unconfirmed user", async () => {
    const passwordHash = await bcrypt.hash("Password123", 12);
    await storage.createUser({
      email: "login-test-unconfirmed@example.com",
      fullName: "Test User",
      firstName: "Test",
      lastName: "User",
      phone: "",
      passwordHash,
      isEmailConfirmed: false,
      status: "pending_email_confirmation",
      emailConfirmedAt: null,
    });

    const res = await request(server)
      .post("/api/auth/login")
      .send({ email: "login-test-unconfirmed@example.com", password: "Password123" });

    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("email_not_confirmed");
  });

  it("allows login for confirmed user", async () => {
    const passwordHash = await bcrypt.hash("Password123", 12);
    await storage.createUser({
      email: "login-test-confirmed@example.com",
      fullName: "Test User",
      firstName: "Test",
      lastName: "User",
      phone: "",
      passwordHash,
      isEmailConfirmed: true,
      status: "active",
      emailConfirmedAt: new Date(),
    });

    const res = await request(server)
      .post("/api/auth/login")
      .send({ email: "login-test-confirmed@example.com", password: "Password123" });

    expect(res.status).toBe(200);
  });
});

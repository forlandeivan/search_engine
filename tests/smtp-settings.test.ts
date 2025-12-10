import { describe, it, expect } from "vitest";

import { SmtpSettingsError, SmtpSettingsService } from "../server/smtp-settings";
import { SmtpTestService } from "../server/smtp-test-service";

describe("SmtpSettingsService", () => {
  const createRepo = () => {
    let record: any | null = null;
    return {
      get: async () => record,
      upsert: async (settings: any) => {
        record = { ...settings };
        return record;
      },
      getRecord: () => record,
    };
  };

  it("returns default dto when no settings stored", async () => {
    const repo = createRepo();
    const service = new SmtpSettingsService(repo);

    const result = await service.getSettings();
    expect(result.hasPassword).toBe(false);
    expect(result.host).toBe("");
  });

  it("saves valid settings and reports hasPassword", async () => {
    const repo = createRepo();
    const service = new SmtpSettingsService(repo);

    const result = await service.updateSettings({
      host: "smtp.example.com",
      port: 587,
      useTls: true,
      useSsl: false,
      username: "user",
      password: "secret",
      fromEmail: "noreply@example.com",
      fromName: "Example",
    });

    expect(result.host).toBe("smtp.example.com");
    expect(result.hasPassword).toBe(true);
  });

  it("rejects simultaneous TLS and SSL", async () => {
    const repo = createRepo();
    const service = new SmtpSettingsService(repo);

    await expect(
      service.updateSettings({
        host: "smtp.example.com",
        port: 25,
        useTls: true,
        useSsl: true,
        username: null,
        password: "secret",
        fromEmail: "noreply@example.com",
        fromName: null,
      }),
    ).rejects.toBeInstanceOf(SmtpSettingsError);
  });

  it("keeps existing password when not provided", async () => {
    const repo = createRepo();
    const service = new SmtpSettingsService(repo);

    await service.updateSettings({
      host: "smtp.example.com",
      port: 465,
      useTls: false,
      useSsl: true,
      username: "user",
      password: "first",
      fromEmail: "noreply@example.com",
      fromName: null,
    });

    const updated = await service.updateSettings({
      host: "smtp.example.net",
      port: 465,
      useTls: false,
      useSsl: true,
      username: "user2",
      password: "",
      fromEmail: "noreply@example.com",
      fromName: null,
    });

    expect(updated.host).toBe("smtp.example.net");
    expect(updated.hasPassword).toBe(true);
    expect(repo.getRecord()?.password).toBe("first");
  });

  it("fails validation for long host", async () => {
    const repo = createRepo();
    const service = new SmtpSettingsService(repo);
    const longHost = "x".repeat(260);

    await expect(
      service.updateSettings({
        host: longHost,
        port: 25,
        useTls: false,
        useSsl: false,
        username: null,
        password: "pwd",
        fromEmail: "noreply@example.com",
        fromName: null,
      }),
    ).rejects.toBeInstanceOf(SmtpSettingsError);
  });
});

describe("SmtpTestService", () => {
  it("rejects invalid test email", async () => {
    const repo = {
      get: async () => null,
      upsert: async (s: any) => s,
    };
    const service = new SmtpTestService({
      // @ts-expect-error test override
      sendTestEmail: async () => {},
    } as any);
    await expect(service.sendTestEmail("bad-email")).rejects.toBeInstanceOf(SmtpSettingsError);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";

import app from "../server";
import { maintenanceModeSettingsService } from "../server/maintenance-mode-settings";

const activeStatus = {
  status: "active" as const,
  scheduledStartAt: null,
  scheduledEndAt: null,
  forceEnabled: true,
  messageTitle: "",
  messageBody: "",
  publicEta: null,
  serverTime: new Date().toISOString(),
};

describe("maintenance mode middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks non-allowlist requests when active", async () => {
    vi.spyOn(maintenanceModeSettingsService, "getEffectiveStatus").mockResolvedValue(activeStatus);

    const response = await supertest(app).get("/api/auth/session");

    expect(response.status).toBe(503);
    expect(response.body?.errorCode).toBe("MAINTENANCE_MODE");
  });

  it("allows /api/maintenance/status when active", async () => {
    vi.spyOn(maintenanceModeSettingsService, "getEffectiveStatus").mockResolvedValue(activeStatus);

    const response = await supertest(app).get("/api/maintenance/status");

    expect(response.status).toBe(200);
    expect(response.body?.status).toBe("active");
  });

  it("does not return maintenance error for /api/admin/*", async () => {
    vi.spyOn(maintenanceModeSettingsService, "getEffectiveStatus").mockResolvedValue(activeStatus);

    const response = await supertest(app).get("/api/admin/settings/maintenance");

    expect(response.status).not.toBe(503);
    expect(response.body?.errorCode).not.toBe("MAINTENANCE_MODE");
  });

  it("allows request through when getEffectiveStatus throws (fail-open)", async () => {
    vi.spyOn(maintenanceModeSettingsService, "getEffectiveStatus").mockRejectedValue(
      new Error("Database connection failed"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await supertest(app).get("/api/auth/session");

    // Should NOT return 503 MAINTENANCE_MODE - should fail-open and pass to next handler
    expect(response.body?.errorCode).not.toBe("MAINTENANCE_MODE");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[maintenance-mode-guard]"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});

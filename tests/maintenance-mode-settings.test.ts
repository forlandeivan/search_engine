import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MaintenanceModeSettingsService } from "../server/maintenance-mode-settings";
import type { MaintenanceModeScheduleDto } from "../shared/maintenance-mode";
import { getCache } from "../server/cache";

const createRepo = () => {
  let record: any | null = null;
  return {
    get: async () => record,
    upsert: async (settings: any) => {
      record = { ...settings };
      return record;
    },
  };
};

const createService = (schedule: MaintenanceModeScheduleDto | null = null) => {
  const repo = createRepo();
  const scheduleService = {
    findNearestSchedule: async () => schedule,
  };
  const forceSessionService = {
    startSession: async () => null,
    endActiveSession: async () => {},
    updateActiveSessionMessages: async () => {},
  };
  return new MaintenanceModeSettingsService(
    repo as any,
    scheduleService as any,
    forceSessionService as any,
  );
};

describe("MaintenanceModeSettingsService getEffectiveStatus", () => {
  beforeEach(async () => {
    await getCache().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns off by default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

    const service = createService();
    const status = await service.getEffectiveStatus();

    expect(status.status).toBe("off");
    expect(status.serverTime).toContain("2026-01-01");
  });

  it("returns scheduled when now is before start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));

    const service = createService({
      id: "schedule-1",
      scheduledStartAt: "2026-01-01T12:00:00.000Z",
      scheduledEndAt: "2026-01-01T14:00:00.000Z",
      messageTitle: "",
      messageBody: "",
      publicEta: null,
      createdByAdminId: null,
      updatedByAdminId: null,
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
    });

    const status = await service.getEffectiveStatus();
    expect(status.status).toBe("scheduled");
  });

  it("returns active when now is within schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T13:00:00.000Z"));

    const service = createService({
      id: "schedule-1",
      scheduledStartAt: "2026-01-01T12:00:00.000Z",
      scheduledEndAt: "2026-01-01T14:00:00.000Z",
      messageTitle: "",
      messageBody: "",
      publicEta: null,
      createdByAdminId: null,
      updatedByAdminId: null,
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-01T09:00:00.000Z",
    });

    const status = await service.getEffectiveStatus();
    expect(status.status).toBe("active");
  });

  it("returns off when now is after end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T15:00:00.000Z"));

    const service = createService(null);

    const status = await service.getEffectiveStatus();
    expect(status.status).toBe("off");
  });

  it("forceEnabled overrides schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T08:00:00.000Z"));

    const service = createService();
    await service.updateSettings({
      forceEnabled: true,
      messageTitle: "",
      messageBody: "",
      publicEta: null,
    });

    const status = await service.getEffectiveStatus();
    expect(status.status).toBe("active");
  });
});

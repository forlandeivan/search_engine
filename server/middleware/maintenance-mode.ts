import type { RequestHandler } from "express";

import { maintenanceModeSettingsService } from "../maintenance-mode-settings";

const ALLOWED_PATH_PREFIXES = [
  "/api/maintenance/",
  "/api/health/",
  "/api/metrics",
  "/metrics",
  "/api/admin/",
] as const;

const MAINTENANCE_ERROR_CODE = "MAINTENANCE_MODE";

function isAllowedPath(path: string): boolean {
  return ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function buildMaintenancePayload(status: {
  messageTitle?: string | null;
  messageBody?: string | null;
  scheduledEndAt?: string | null;
  publicEta?: string | null;
}) {
  const message =
    (typeof status.messageTitle === "string" && status.messageTitle.trim().length > 0
      ? status.messageTitle.trim()
      : null) ?? "Идут технические работы";

  return {
    errorCode: MAINTENANCE_ERROR_CODE,
    message,
    messageTitle: status.messageTitle ?? null,
    messageBody: status.messageBody ?? null,
    scheduledEndAt: status.scheduledEndAt ?? null,
    publicEta: status.publicEta ?? null,
  };
}

export const maintenanceModeGuard: RequestHandler = async (req, res, next) => {
  try {
    const fullPath = req.originalUrl || req.url;

    // Apply guard only for API requests and metrics endpoint
    if (!fullPath.startsWith("/api") && !fullPath.startsWith("/metrics")) {
      return next();
    }

    const status = await maintenanceModeSettingsService.getEffectiveStatus();
    if (status.status !== "active") {
      return next();
    }

    if (isAllowedPath(fullPath)) {
      return next();
    }

    return res.status(503).json(buildMaintenancePayload(status));
  } catch (error) {
    // Fail-open: if we can't determine maintenance status, allow request through
    // This prevents false maintenance mode when DB is unavailable or table doesn't exist
    console.error("[maintenance-mode-guard] Error checking maintenance status, allowing request:", error);
    return next();
  }
};

export default maintenanceModeGuard;

import { Router } from "express";

import { asyncHandler } from "../middleware/async-handler";
import { maintenanceModeSettingsService } from "../maintenance-mode-settings";

export const maintenanceRouter = Router();

/**
 * GET /status
 * Public maintenance mode status (no auth)
 */
maintenanceRouter.get("/status", asyncHandler(async (_req, res) => {
  const status = await maintenanceModeSettingsService.getEffectiveStatus();
  res.json(status);
}));

export default maintenanceRouter;

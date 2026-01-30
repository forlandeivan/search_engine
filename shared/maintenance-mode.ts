import { z } from "zod";

export const MAINTENANCE_MODE_STATUSES = ["off", "scheduled", "active"] as const;

export const maintenanceModeSettingsSchema = z
  .object({
    scheduledStartAt: z.string().datetime().nullable(),
    scheduledEndAt: z.string().datetime().nullable(),
    forceEnabled: z.boolean(),
    messageTitle: z.string().trim().max(120),
    messageBody: z.string().trim().max(2000),
    publicEta: z.string().trim().max(255).nullable(),
  })
  .refine(
    (value) => {
      const hasStart = Boolean(value.scheduledStartAt);
      const hasEnd = Boolean(value.scheduledEndAt);
      return hasStart === hasEnd;
    },
    {
      message: "scheduledStartAt and scheduledEndAt must be set together",
      path: ["scheduledEndAt"],
    },
  )
  .refine(
    (value) => {
      if (!value.scheduledStartAt || !value.scheduledEndAt) {
        return true;
      }
      return new Date(value.scheduledStartAt).getTime() < new Date(value.scheduledEndAt).getTime();
    },
    {
      message: "scheduledStartAt must be earlier than scheduledEndAt",
      path: ["scheduledEndAt"],
    },
  );

export const updateMaintenanceModeSettingsSchema = maintenanceModeSettingsSchema;

export const maintenanceModeStatusSchema = z.object({
  status: z.enum(MAINTENANCE_MODE_STATUSES),
  scheduledStartAt: z.string().datetime().nullable(),
  scheduledEndAt: z.string().datetime().nullable(),
  messageTitle: z.string().trim().max(120),
  messageBody: z.string().trim().max(2000),
  publicEta: z.string().trim().max(255).nullable(),
  serverTime: z.string().datetime(),
});

export type MaintenanceModeSettingsDto = z.infer<typeof maintenanceModeSettingsSchema>;
export type UpdateMaintenanceModeSettingsDto = z.infer<typeof updateMaintenanceModeSettingsSchema>;
export type MaintenanceModeStatusDto = z.infer<typeof maintenanceModeStatusSchema>;

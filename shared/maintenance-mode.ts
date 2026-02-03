import { z } from "zod";

export const MAINTENANCE_MODE_STATUSES = ["off", "scheduled", "active"] as const;

export const maintenanceModeScheduleInputSchema = z
  .object({
    scheduledStartAt: z.string().datetime(),
    scheduledEndAt: z.string().datetime(),
    messageTitle: z.string().trim().max(120),
    messageBody: z.string().trim().max(2000),
    publicEta: z.string().trim().max(255).nullable(),
  })
  .refine(
    (value) => new Date(value.scheduledStartAt).getTime() < new Date(value.scheduledEndAt).getTime(),
    {
      message: "scheduledStartAt must be earlier than scheduledEndAt",
      path: ["scheduledEndAt"],
    },
  );

export const maintenanceModeScheduleSchema = maintenanceModeScheduleInputSchema.extend({
  id: z.string().uuid(),
  createdByAdminId: z.string().nullable().optional(),
  updatedByAdminId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const maintenanceModeScheduleListItemSchema = maintenanceModeScheduleSchema.extend({
  initiatorName: z.string().nullable(),
});

export const maintenanceModeForceSessionSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  createdByAdminId: z.string().nullable().optional(),
  endedByAdminId: z.string().nullable().optional(),
  messageTitle: z.string().trim().max(120),
  messageBody: z.string().trim().max(2000),
  publicEta: z.string().trim().max(255).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const maintenanceModeForceSessionListItemSchema = maintenanceModeForceSessionSchema.extend({
  initiatorName: z.string().nullable(),
});

export const maintenanceModeSettingsSchema = z.object({
  forceEnabled: z.boolean(),
  messageTitle: z.string().trim().max(120),
  messageBody: z.string().trim().max(2000),
  publicEta: z.string().trim().max(255).nullable(),
});

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

export const maintenanceModeIntervalSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["schedule", "force"]),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable(),
  status: z.enum(["past", "scheduled", "active"]),
  initiatorName: z.string().nullable(),
  messageTitle: z.string().trim().max(120),
  messageBody: z.string().trim().max(2000),
  publicEta: z.string().trim().max(255).nullable(),
});

export type MaintenanceModeSettingsDto = z.infer<typeof maintenanceModeSettingsSchema>;
export type UpdateMaintenanceModeSettingsDto = z.infer<typeof updateMaintenanceModeSettingsSchema>;
export type MaintenanceModeStatusDto = z.infer<typeof maintenanceModeStatusSchema>;
export type MaintenanceModeScheduleDto = z.infer<typeof maintenanceModeScheduleSchema>;
export type MaintenanceModeScheduleInputDto = z.infer<typeof maintenanceModeScheduleInputSchema>;
export type MaintenanceModeScheduleListItemDto = z.infer<typeof maintenanceModeScheduleListItemSchema>;
export type MaintenanceModeIntervalDto = z.infer<typeof maintenanceModeIntervalSchema>;
export type MaintenanceModeForceSessionDto = z.infer<typeof maintenanceModeForceSessionSchema>;
export type MaintenanceModeForceSessionListItemDto = z.infer<typeof maintenanceModeForceSessionListItemSchema>;

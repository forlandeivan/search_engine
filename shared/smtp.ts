import { z } from "zod";

export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  useTls: z.boolean(),
  useSsl: z.boolean(),
  username: z.string().trim().max(255).nullable(),
  fromEmail: z.string().trim().min(1).max(255),
  fromName: z.string().trim().max(255).nullable(),
  hasPassword: z.boolean(),
});

export const updateSmtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  useTls: z.boolean(),
  useSsl: z.boolean(),
  username: z.string().trim().max(255).nullable().optional(),
  password: z.string().max(255).optional().or(z.literal("")),
  fromEmail: z.string().trim().min(1).max(255),
  fromName: z.string().trim().max(255).nullable().optional(),
});

export type SmtpSettingsDto = z.infer<typeof smtpSettingsSchema>;
export type UpdateSmtpSettingsDto = z.infer<typeof updateSmtpSettingsSchema>;

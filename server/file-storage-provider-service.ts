import { storage } from "./storage";
import type { FileStorageProvider, FileStorageProviderInsert } from "@shared/schema";
import { z } from "zod";
import { validatePathTemplate } from "./file-storage-path";
import { isPgError } from "./pg-utils";

export class FileStorageProviderServiceError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
    this.name = "FileStorageProviderServiceError";
  }
}

export class FileStorageProviderNotFoundError extends FileStorageProviderServiceError {
  constructor(message = "Provider not found") {
    super(message, 404);
    this.name = "FileStorageProviderNotFoundError";
  }
}

const authTypeSchema = z.enum(["none", "bearer"]);

const providerConfigSchema = z
  .object({
    uploadMethod: z.enum(["POST", "PUT"]).optional(),
    pathTemplate: z.string().trim().min(1, "pathTemplate is required").max(500).optional(),
    multipartFieldName: z.string().trim().min(1, "multipartFieldName is required").max(100).optional(),
    metadataFieldName: z.string().trim().max(100).nullable().optional(),
    responseFileIdPath: z.string().trim().min(1, "responseFileIdPath is required").max(200).optional(),
    defaultTimeoutMs: z.number().int().min(0).max(600_000).optional(), // 0 — без таймаута, до 10 минут
    bucket: z.string().trim().max(200).nullable().optional(),
  })
  .optional();

const baseProviderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Field 'name' is required")
    .max(200, "Field 'name' is too long"),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Field 'baseUrl' is required")
    .transform((value, ctx) => {
      try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "baseUrl must use http/https scheme", path: ["baseUrl"] });
          return z.NEVER;
        }
        return parsed.toString();
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid value for field 'baseUrl'", path: ["baseUrl"] });
        return z.NEVER;
      }
    }),
  description: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
  authType: authTypeSchema.default("none"),
  config: providerConfigSchema,
});

const createProviderSchema = baseProviderSchema;
const updateProviderSchema = baseProviderSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

export const defaultProviderConfig = {
  uploadMethod: "POST",
  pathTemplate: "/{workspaceId}/{objectKey}",
  multipartFieldName: "file",
  metadataFieldName: "metadata",
  responseFileIdPath: "fileUri",
  defaultTimeoutMs: 15000,
  bucket: null,
} as const;

export function normalizeFileProviderConfig(input: z.infer<typeof providerConfigSchema> | undefined | null) {
  const cfg = input ?? {};
  const hasTimeout = cfg.defaultTimeoutMs !== undefined && cfg.defaultTimeoutMs !== null;
  const pathTemplate = cfg.pathTemplate ?? defaultProviderConfig.pathTemplate;
  try {
    validatePathTemplate(pathTemplate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid pathTemplate";
    throw new FileStorageProviderServiceError(message, 400);
  }
  return {
    uploadMethod: (cfg.uploadMethod ?? defaultProviderConfig.uploadMethod) as "POST" | "PUT",
    pathTemplate,
    multipartFieldName: cfg.multipartFieldName ?? defaultProviderConfig.multipartFieldName,
    metadataFieldName:
      cfg.metadataFieldName === undefined ? defaultProviderConfig.metadataFieldName : cfg.metadataFieldName,
    responseFileIdPath: cfg.responseFileIdPath ?? defaultProviderConfig.responseFileIdPath,
    defaultTimeoutMs: hasTimeout ? cfg.defaultTimeoutMs : defaultProviderConfig.defaultTimeoutMs,
    bucket: cfg.bucket ?? defaultProviderConfig.bucket,
  };
}

function normalizePayload(input: z.infer<typeof createProviderSchema>): FileStorageProviderInsert {
  return {
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    description: input.description?.trim() || null,
    isActive: input.isActive ?? true,
    authType: input.authType ?? "none",
    config: normalizeFileProviderConfig(input.config),
  };
}

class FileStorageProviderService {
  async listProviders(options: { limit?: number; offset?: number } = {}) {
    return storage.listFileStorageProviders(options);
  }

  async getProviderById(id: string): Promise<FileStorageProvider> {
    const provider = await storage.getFileStorageProvider(id);
    if (!provider) {
      throw new FileStorageProviderNotFoundError();
    }
    return provider;
  }

  async createProvider(payload: unknown): Promise<FileStorageProvider> {
    const parsed = createProviderSchema.parse(payload);
    try {
      return await storage.createFileStorageProvider(normalizePayload(parsed));
    } catch (error) {
      if (isPgError(error) && error.code === "23505") {
        throw new FileStorageProviderServiceError("Provider with the same name already exists", 409);
      }
      throw error;
    }
  }

  async updateProvider(id: string, payload: unknown): Promise<FileStorageProvider> {
    const parsed = updateProviderSchema.parse(payload);
    const existing = await storage.getFileStorageProvider(id);
    if (!existing) {
      throw new FileStorageProviderNotFoundError();
    }
    const nextConfig =
      parsed.config !== undefined
        ? normalizeFileProviderConfig(parsed.config)
        : normalizeFileProviderConfig(existing.config ?? {});
    const provider = await storage.updateFileStorageProvider(id, {
      name: parsed.name?.trim(),
      baseUrl: parsed.baseUrl?.trim(),
      description: parsed.description === undefined ? undefined : parsed.description?.trim() || null,
      isActive: parsed.isActive,
      authType: parsed.authType,
      config: nextConfig,
    });
    if (!provider) {
      throw new FileStorageProviderNotFoundError();
    }
    return provider;
  }

  async deleteProvider(id: string): Promise<void> {
    const deleted = await storage.deleteFileStorageProvider(id);
    if (!deleted) {
      throw new FileStorageProviderNotFoundError();
    }
  }

  // Aliases for consistent naming in admin routes
  async list(): Promise<FileStorageProvider[]> {
    const result = await this.listProviders();
    return result.items;
  }

  async getById(id: string): Promise<FileStorageProvider> {
    return this.getProviderById(id);
  }

  async create(payload: unknown): Promise<FileStorageProvider> {
    return this.createProvider(payload);
  }

  async update(id: string, payload: unknown): Promise<FileStorageProvider> {
    return this.updateProvider(id, payload);
  }

  async delete(id: string): Promise<void> {
    return this.deleteProvider(id);
  }

  async getWorkspaceDefault(workspaceId: string): Promise<FileStorageProvider | null> {
    const workspace = await storage.getWorkspace(workspaceId);
    if (!workspace) {
      throw new FileStorageProviderServiceError("Workspace not found", 404);
    }
    return storage.getWorkspaceDefaultFileStorageProvider(workspaceId);
  }

  async setWorkspaceDefault(workspaceId: string, providerId: string | null): Promise<FileStorageProvider | null> {
    const workspace = await storage.getWorkspace(workspaceId);
    if (!workspace) {
      throw new FileStorageProviderServiceError("Workspace not found", 404);
    }

    if (providerId) {
      const provider = await storage.getFileStorageProvider(providerId);
      if (!provider) {
        throw new FileStorageProviderServiceError("Provider not found", 404);
      }
      if (!provider.isActive) {
        throw new FileStorageProviderServiceError("Provider is inactive", 400);
      }
    }

    await storage.setWorkspaceDefaultFileStorageProvider(workspaceId, providerId);
    return providerId ? await this.getProviderById(providerId) : null;
  }
}

export const fileStorageProviderService = new FileStorageProviderService();

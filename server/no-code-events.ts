import fetch, { Headers } from "node-fetch";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { skills } from "@shared/schema";
import { applyTlsPreferences } from "./http-utils";
import type { NoCodeAuthType } from "@shared/schema";
import { z } from "zod";
import { addNoCodeSyncFinalResults } from "./chat-service";

export type NoCodeConnectionInternal = {
  endpointUrl: string | null;
  authType: NoCodeAuthType;
  bearerToken: string | null;
};

export type MessageCreatedEventPayload = {
  schemaVersion: 1;
  event: "message.created";
  eventId: string;
  occurredAt: string;
  workspace: { id: string };
  chat: { id: string };
  skill: { id: string; executionMode: "no_code" };
  message: {
    id: string;
    type?: "text" | "file" | string;
    role: "user" | "assistant" | "system";
    text: string;
    file?: {
      attachmentId?: string | null;
      filename?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      downloadUrl?: string | null;
      expiresAt?: string | null;
      uploadedByUserId?: string | null;
    };
    createdAt: string;
    metadata: Record<string, unknown>;
  };
  actor: { userId: string };
  contextPack?: Record<string, unknown>;
};

export type SyncFinalResult = {
  role: "assistant" | "user" | "system";
  text: string;
  resultId: string;
  triggerMessageId?: string | null;
};

export type SyncFinalResponse = {
  mode: "sync_final";
  results: SyncFinalResult[];
};

export type FileUploadedEventPayload = {
  schemaVersion: 1;
  event: "file.uploaded";
  eventId: string;
  occurredAt: string;
  workspace: { id: string };
  chat: { id: string };
  skill: { id: string };
  message: { id: string; createdAt: string; type: "file" };
  actor: { userId: string };
  file: {
    attachmentId: string | null;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    downloadUrl: string;
    expiresAt: string | null;
    uploadedByUserId?: string | null;
  };
  meta?: Record<string, unknown>;
};

const syncFinalResultSchema = z.object({
  role: z.enum(["assistant", "user", "system"]),
  text: z.string(),
  resultId: z.string().min(1),
  triggerMessageId: z.string().min(1).optional(),
});

const syncFinalResponseSchema = z.object({
  mode: z.literal("sync_final"),
  results: z.array(syncFinalResultSchema).min(1),
});

export function parseSyncFinalResponse(payload: unknown): SyncFinalResponse | null {
  const parsed = syncFinalResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

const sanitizeFileMetadata = (fileMeta: unknown): Record<string, unknown> | null => {
  if (!fileMeta || typeof fileMeta !== "object") {
    return null;
  }
  const { storageKey, ...rest } = fileMeta as Record<string, unknown>;
  return { ...rest };
};

export async function getNoCodeConnectionInternal(opts: {
  workspaceId: string;
  skillId: string;
}): Promise<NoCodeConnectionInternal | null> {
  const rows = await db
    .select({
      endpointUrl: skills.noCodeEndpointUrl,
      authType: skills.noCodeAuthType,
      bearerToken: skills.noCodeBearerToken,
    })
    .from(skills)
    .where(and(eq(skills.id, opts.skillId), eq(skills.workspaceId, opts.workspaceId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const endpointUrl = typeof row.endpointUrl === "string" ? row.endpointUrl.trim() : null;
  const authType = (row.authType as NoCodeAuthType) ?? "none";
  const bearerToken = typeof row.bearerToken === "string" ? row.bearerToken : null;

  return {
    endpointUrl: endpointUrl && endpointUrl.length > 0 ? endpointUrl : null,
    authType,
    bearerToken: bearerToken && bearerToken.trim().length > 0 ? bearerToken : null,
  };
}

export function buildMessageCreatedEventPayload(args: {
  workspaceId: string;
  chatId: string;
  skillId: string;
  message: { id: string; role: "user" | "assistant" | "system"; content: string; createdAt: string; metadata?: unknown };
  actorUserId: string;
  contextPack?: Record<string, unknown> | null;
}): MessageCreatedEventPayload {
  const metadata =
    args.message.metadata && typeof args.message.metadata === "object"
      ? (args.message.metadata as Record<string, unknown>)
      : {};
  const sanitizedMetadata: Record<string, unknown> = { ...metadata };
  const fileMeta = sanitizeFileMetadata((metadata as any).file);
  if (fileMeta) {
    sanitizedMetadata.file = fileMeta;
  } else if ("file" in sanitizedMetadata) {
    delete (sanitizedMetadata as any).file;
  }
  const file =
    fileMeta && typeof fileMeta === "object"
      ? {
          attachmentId: (fileMeta as any).attachmentId ?? null,
          filename: (fileMeta as any).filename ?? null,
          mimeType: (fileMeta as any).mimeType ?? null,
          sizeBytes: typeof (fileMeta as any).sizeBytes === "number" ? (fileMeta as any).sizeBytes : null,
          downloadUrl: (fileMeta as any).downloadUrl ?? `/api/chat/messages/${args.message.id}/file`,
          expiresAt: (fileMeta as any).expiresAt ?? null,
          uploadedByUserId: (fileMeta as any).uploadedByUserId ?? null,
        }
      : undefined;

  return {
    schemaVersion: 1,
    event: "message.created",
    eventId: args.message.id,
    occurredAt: new Date().toISOString(),
    workspace: { id: args.workspaceId },
    chat: { id: args.chatId },
    skill: { id: args.skillId, executionMode: "no_code" },
    message: {
      id: args.message.id,
      type: (args.message as any).messageType ?? (file ? "file" : "text"),
      role: args.message.role,
      text: args.message.content,
      file,
      createdAt: args.message.createdAt,
      metadata: sanitizedMetadata,
    },
    actor: { userId: args.actorUserId },
    ...(args.contextPack ? { contextPack: args.contextPack } : {}),
  };
}

export async function deliverNoCodeEvent(opts: {
  endpointUrl: string;
  authType: NoCodeAuthType;
  bearerToken: string | null;
  payload: MessageCreatedEventPayload;
  idempotencyKey?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; responseText: string; syncFinal: SyncFinalResponse | null }> {
  const timeoutMs = Math.max(100, Math.trunc(opts.timeoutMs ?? 10_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  if (opts.idempotencyKey) {
    headers.set("Idempotency-Key", opts.idempotencyKey);
  }

  if (opts.authType === "bearer") {
    if (!opts.bearerToken) {
      throw new Error("No-code bearer token is missing");
    }
    headers.set("Authorization", `Bearer ${opts.bearerToken}`);
  }

  const request = applyTlsPreferences(
    {
      method: "POST",
      headers,
      body: JSON.stringify(opts.payload),
      signal: controller.signal,
    },
    false,
  );

  try {
    const response = await fetch(opts.endpointUrl, request);
    const responseText = await response.text();
    let syncFinal: SyncFinalResponse | null = null;
    try {
      const parsedJson = JSON.parse(responseText);
      syncFinal = parseSyncFinalResponse(parsedJson);
    } catch {
      syncFinal = null;
    }
    return { ok: response.ok, status: response.status, responseText, syncFinal };
  } finally {
    clearTimeout(timer);
  }
}

export function scheduleNoCodeEventDelivery(opts: {
  endpointUrl: string;
  authType: NoCodeAuthType;
  bearerToken: string | null;
  payload: MessageCreatedEventPayload | FileUploadedEventPayload;
  idempotencyKey?: string;
}): void {
  void (async () => {
    try {
      const result = await deliverNoCodeEvent({
        endpointUrl: opts.endpointUrl,
        authType: opts.authType,
        bearerToken: opts.bearerToken,
        payload: opts.payload as MessageCreatedEventPayload,
        idempotencyKey: opts.idempotencyKey,
        timeoutMs: 2000,
      });

      if (!result.ok) {
        console.warn(`[no-code] ${opts.payload.event} delivery failed`, {
          eventId: opts.payload.eventId,
          status: result.status,
        });
        return;
      }

      console.info(`[no-code] ${opts.payload.event} delivered`, {
        eventId: opts.payload.eventId,
        status: result.status,
      });

      if (result.syncFinal?.results?.length) {
        try {
          await addNoCodeSyncFinalResults({
            workspaceId: opts.payload.workspace.id,
            chatId: opts.payload.chat.id,
            skillId: opts.payload.skill.id,
            triggerMessageId: opts.payload.message.id,
            results: result.syncFinal.results,
          });
        } catch (error) {
          console.warn("[no-code] failed to apply sync_final results", {
            eventId: opts.payload.eventId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      console.warn("[no-code] message.created delivery error", {
        eventId: opts.payload.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

export function buildFileUploadedEventPayload(args: {
  workspaceId: string;
  chatId: string;
  skillId: string;
  message: { id: string; createdAt: string };
  actorUserId: string;
  file: {
    attachmentId: string | null;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    downloadUrl: string;
    expiresAt: string | null;
    uploadedByUserId?: string | null;
  };
  meta?: Record<string, unknown>;
}): FileUploadedEventPayload {
  return {
    schemaVersion: 1,
    event: "file.uploaded",
    eventId: args.message.id,
    occurredAt: new Date().toISOString(),
    workspace: { id: args.workspaceId },
    chat: { id: args.chatId },
    skill: { id: args.skillId },
    message: { id: args.message.id, createdAt: args.message.createdAt, type: "file" },
    actor: { userId: args.actorUserId },
    file: { ...args.file },
    ...(args.meta ? { meta: args.meta } : {}),
  };
}

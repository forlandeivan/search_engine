import fetch, { Headers } from "node-fetch";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { skills } from "@shared/schema";
import { applyTlsPreferences } from "./http-utils";
import type { NoCodeAuthType } from "@shared/schema";
import { z } from "zod";

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
    role: "user" | "assistant" | "system";
    text: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  };
  actor: { userId: string };
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
}): MessageCreatedEventPayload {
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
      role: args.message.role,
      text: args.message.content,
      createdAt: args.message.createdAt,
      metadata:
        args.message.metadata && typeof args.message.metadata === "object"
          ? (args.message.metadata as Record<string, unknown>)
          : {},
    },
    actor: { userId: args.actorUserId },
  };
}

export async function deliverNoCodeEvent(opts: {
  endpointUrl: string;
  authType: NoCodeAuthType;
  bearerToken: string | null;
  payload: MessageCreatedEventPayload;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; responseText: string }> {
  const timeoutMs = Math.max(100, Math.trunc(opts.timeoutMs ?? 10_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

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
    return { ok: response.ok, status: response.status, responseText };
  } finally {
    clearTimeout(timer);
  }
}

export function scheduleNoCodeEventDelivery(opts: {
  endpointUrl: string;
  authType: NoCodeAuthType;
  bearerToken: string | null;
  payload: MessageCreatedEventPayload;
}): void {
  void (async () => {
    try {
      const result = await deliverNoCodeEvent({
        endpointUrl: opts.endpointUrl,
        authType: opts.authType,
        bearerToken: opts.bearerToken,
        payload: opts.payload,
      });

      if (!result.ok) {
        console.warn("[no-code] message.created delivery failed", {
          eventId: opts.payload.eventId,
          status: result.status,
        });
        return;
      }

      console.info("[no-code] message.created delivered", {
        eventId: opts.payload.eventId,
        status: result.status,
      });
    } catch (error) {
      console.warn("[no-code] message.created delivery error", {
        eventId: opts.payload.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

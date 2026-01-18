import { randomUUID } from "crypto";
import type { File, FileKind, NoCodeAuthType } from "@shared/schema";
import { storage } from "./storage";
import { decryptSecret } from "./secret-storage";

export type FileEventAction = "file_uploaded" | "file_deleted";

function sanitizeTargetUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Remove whitespace/control chars inside URL that break fetch/URL parsing.
  const cleaned = trimmed.replace(/[\s\r\n\t]+/g, "");
  try {
    new URL(cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

export type FileEventPayload = {
  schemaVersion: 1;
  eventId: string;
  action: FileEventAction;
  occurredAt: string;
  file: {
    id: string;
    type: FileKind;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    providerId: string | null;
    providerFileId: string | null;
  };
  workspaceId: string;
  skillId: string | null;
  chatId: string | null;
  userId: string | null;
  messageId?: string | null;
};

export function buildFileEventPayload(opts: {
  file: File;
  action: FileEventAction;
  occurredAt?: string;
}): FileEventPayload {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    action: opts.action,
    occurredAt: opts.occurredAt ?? new Date().toISOString(),
    file: {
      id: opts.file.id,
      type: opts.file.kind,
      filename: opts.file.name ?? null,
      mimeType: opts.file.mimeType ?? null,
      sizeBytes: opts.file.sizeBytes !== null && opts.file.sizeBytes !== undefined ? Number(opts.file.sizeBytes) : null,
      providerId: ("providerId" in opts.file && typeof opts.file.providerId === "string" ? opts.file.providerId : null) ?? null,
      providerFileId: ("providerFileId" in opts.file && typeof opts.file.providerFileId === "string" ? opts.file.providerFileId : null) ?? null,
    },
    workspaceId: opts.file.workspaceId,
    skillId: opts.file.skillId ?? null,
    chatId: opts.file.chatId ?? null,
    userId: opts.file.userId ?? null,
    messageId: ("messageId" in opts.file && typeof opts.file.messageId === "string" ? opts.file.messageId : null) ?? null,
  };
}

export async function enqueueFileEventForSkill(opts: {
  file: File;
  action: FileEventAction;
  skill: {
    executionMode?: string | null;
    noCodeFileEventsUrl?: string | null;
    noCodeEndpointUrl?: string | null;
    noCodeAuthType?: NoCodeAuthType | null;
    noCodeBearerToken?: string | null;
  };
}): Promise<void> {
  const isNoCode = opts.skill.executionMode === "no_code";
  const targetUrl = sanitizeTargetUrl(opts.skill.noCodeFileEventsUrl ?? opts.skill.noCodeEndpointUrl ?? null);
  if (!isNoCode || !targetUrl) {
    if (isNoCode) {
      console.warn("[file-events] skip enqueue: no target URL for no-code skill", {
        skillId: opts.file.skillId ?? null,
        workspaceId: opts.file.workspaceId,
        action: opts.action,
      });
    }
    return;
  }

  const payload = buildFileEventPayload({ file: opts.file, action: opts.action });
  const bearerToken = decryptSecret(opts.skill.noCodeBearerToken ?? null);
  const normalizedBearerToken = bearerToken && bearerToken.trim().length > 0 ? bearerToken.trim() : null;
  await storage.enqueueFileEvent({
    eventId: payload.eventId,
    action: opts.action,
    fileId: opts.file.id,
    workspaceId: opts.file.workspaceId,
    skillId: opts.file.skillId ?? null,
    chatId: opts.file.chatId ?? null,
    userId: opts.file.userId ?? null,
    messageId: ("messageId" in opts.file && typeof opts.file.messageId === "string" ? opts.file.messageId : null) ?? null,
    targetUrl,
    authType: opts.skill.noCodeAuthType ?? "none",
    bearerToken: normalizedBearerToken,
    payload,
  });
}

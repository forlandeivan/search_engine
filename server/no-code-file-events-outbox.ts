import fetch from "node-fetch";
import { storage } from "./storage";
import type { FileEventOutbox } from "@shared/schema";
import { URL } from "url";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

function sanitizeTargetUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s\r\n\t]+/g, "");
  try {
    // Validate URL shape
    new URL(cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

function computeNextAttempt(attempts: number): Date {
  const delay = Math.min(MAX_BACKOFF_MS, BASE_DELAY_MS * Math.max(1, attempts));
  return new Date(Date.now() + delay);
}

function buildHeaders(event: FileEventOutbox): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Event-Id": event.eventId,
    "Idempotency-Key": event.eventId,
  };
  if (event.authType === "bearer" && event.bearerToken) {
    headers.Authorization = `Bearer ${event.bearerToken}`;
  }
  return headers;
}

async function deliver(
  event: FileEventOutbox,
): Promise<{ ok: boolean; status: number; retryable: boolean; errorMessage?: string }> {
  const rawUrl = (event as any).targetUrl ?? (event as any).target_url ?? null;
  const targetUrl = sanitizeTargetUrl(rawUrl);
  if (!targetUrl) {
    return { ok: false, status: 0, retryable: false, errorMessage: "Invalid URL" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: buildHeaders(event),
      body: JSON.stringify(event.payload),
      signal: controller.signal,
    });
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: res.ok, status: res.status, retryable };
  } catch (error) {
    const retryable = true;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, retryable, errorMessage: message };
  } finally {
    clearTimeout(timeout);
  }
}

export function startFileEventOutboxWorker() {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    const job = await storage.claimNextFileEventOutbox().catch((err) => {
      console.error("[file-events] failed to claim job", err);
      return null;
    });
    if (!job) return;

    try {
      const result = await deliver(job);
      if (result.ok) {
        await storage.markFileEventSent(job.id);
        console.info("[file-events] delivered", { eventId: job.eventId, status: result.status });
        return;
      }
      const retryable = result.retryable;
      if (retryable && job.attempts < MAX_ATTEMPTS) {
        const next = computeNextAttempt(job.attempts);
        await storage.rescheduleFileEvent(job.id, next, result.errorMessage ?? `HTTP ${result.status}`);
        return;
      }
      await storage.failFileEvent(job.id, result.errorMessage ?? `HTTP ${result.status}`);
    } catch (error) {
      const retryable = job.attempts < MAX_ATTEMPTS;
      const next = retryable ? computeNextAttempt(job.attempts) : null;
      if (retryable && next) {
        await storage.rescheduleFileEvent(job.id, next, error instanceof Error ? error.message : String(error));
      } else {
        await storage.failFileEvent(job.id, error instanceof Error ? error.message : String(error));
      }
    }
  };

  const interval = setInterval(tick, 2000);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}

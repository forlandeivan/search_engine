import fetch from "node-fetch";
import { storage } from "./storage";
import type { FileEventOutbox } from "@shared/schema";
import { URL } from "url";
import { createLogger } from "./lib/logger";

const logger = createLogger("file-events");

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
  // Handle both camelCase and snake_case field names from raw SQL
  const rawUrl = event.targetUrl ?? (event as any).target_url ?? null;
  const targetUrl = sanitizeTargetUrl(rawUrl);
  if (!targetUrl) {
    logger.warn({ eventId: event.eventId, rawUrl }, "Invalid target URL");
    return { ok: false, status: 0, retryable: false, errorMessage: "Invalid URL" };
  }

  logger.info({
    eventId: event.eventId,
    targetUrl,
    action: event.action,
    fileId: event.fileId,
    attempt: event.attempts,
  }, "Sending file event to external service");

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
    logger.info({
      eventId: event.eventId,
      targetUrl,
      status: res.status,
      ok: res.ok,
      retryable,
    }, "File event delivery response");
    return { ok: res.ok, status: res.status, retryable };
  } catch (error) {
    const retryable = true;
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      eventId: event.eventId,
      targetUrl,
      err: error,
      retryable,
    }, "File event delivery error");
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
      logger.error({ err }, "Failed to claim file event job");
      return null;
    });
    if (!job) return;

    // Log raw job data to debug field mapping
    logger.info({
      eventId: job.eventId,
      fileId: job.fileId,
      targetUrl: job.targetUrl,
      target_url: (job as any).target_url, // Check snake_case version
      jobKeys: Object.keys(job),
      attempts: job.attempts,
    }, "Processing file event from queue");

    try {
      const result = await deliver(job);
      if (result.ok) {
        await storage.markFileEventSent(job.id);
        logger.info({ eventId: job.eventId, status: result.status, targetUrl: job.targetUrl }, "File event delivered successfully");
        return;
      }
      const retryable = result.retryable;
      if (retryable && job.attempts < MAX_ATTEMPTS) {
        const next = computeNextAttempt(job.attempts);
        await storage.rescheduleFileEvent(job.id, next, result.errorMessage ?? `HTTP ${result.status}`);
        logger.warn({
          eventId: job.eventId,
          status: result.status,
          attempts: job.attempts,
          nextAttemptAt: next.toISOString(),
          targetUrl: job.targetUrl,
        }, "File event delivery failed, rescheduling");
        return;
      }
      await storage.failFileEvent(job.id, result.errorMessage ?? `HTTP ${result.status}`);
      logger.error({
        eventId: job.eventId,
        status: result.status,
        attempts: job.attempts,
        targetUrl: job.targetUrl,
        errorMessage: result.errorMessage,
      }, "File event delivery failed permanently");
    } catch (error) {
      const retryable = job.attempts < MAX_ATTEMPTS;
      const next = retryable ? computeNextAttempt(job.attempts) : null;
      if (retryable && next) {
        await storage.rescheduleFileEvent(job.id, next, error instanceof Error ? error.message : String(error));
        logger.warn({
          eventId: job.eventId,
          err: error,
          attempts: job.attempts,
          nextAttemptAt: next.toISOString(),
          targetUrl: job.targetUrl,
        }, "File event delivery error, rescheduling");
      } else {
        await storage.failFileEvent(job.id, error instanceof Error ? error.message : String(error));
        logger.error({
          eventId: job.eventId,
          err: error,
          attempts: job.attempts,
          targetUrl: job.targetUrl,
        }, "File event delivery error, failed permanently");
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

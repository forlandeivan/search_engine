/**
 * Bot Action Watchdog
 * 
 * Automatically marks bot_actions stuck in "processing" status as "error:timeout"
 * if they exceed MAX_PROCESSING_DURATION. This prevents eternal indicators
 * when a worker crashes or fails to send update(done/error).
 * 
 * This is NOT a heartbeat mechanism. Actions can legitimately run for 30+ minutes.
 * The watchdog only cleans up abandoned actions.
 */

import { storage } from "./storage";
import { emitBotAction } from "./chat-events";

// Default: 2 hours (safe for 30-minute tasks)
const DEFAULT_MAX_DURATION_HOURS = 2;

export type BotActionWatchdogOptions = {
  maxProcessingHours: number;
  checkIntervalMinutes: number;
};

export function resolveBotActionWatchdogOptions(): BotActionWatchdogOptions {
  const maxHours = process.env.BOT_ACTION_MAX_PROCESSING_HOURS
    ? parseFloat(process.env.BOT_ACTION_MAX_PROCESSING_HOURS)
    : DEFAULT_MAX_DURATION_HOURS;
  const intervalMinutes = process.env.BOT_ACTION_WATCHDOG_INTERVAL_MINUTES
    ? parseInt(process.env.BOT_ACTION_WATCHDOG_INTERVAL_MINUTES, 10)
    : 30;

  return {
    maxProcessingHours: Number.isFinite(maxHours) && maxHours > 0 ? maxHours : DEFAULT_MAX_DURATION_HOURS,
    checkIntervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 30,
  };
}

export async function runBotActionWatchdog(options?: Partial<BotActionWatchdogOptions>): Promise<{ expired: number }> {
  const opts = { ...resolveBotActionWatchdogOptions(), ...options };
  const maxAgeMs = opts.maxProcessingHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);

  try {
    const expired = await storage.expireStuckBotActions(cutoff);
    if (expired.length > 0) {
      console.info(
        `[bot-action-watchdog] expired ${expired.length} stuck processing actions older than ${opts.maxProcessingHours}h`,
      );
      // Emit realtime events for each expired action so clients update UI
      for (const action of expired) {
        emitBotAction(action.chatId, action);
      }
    }
    return { expired: expired.length };
  } catch (error) {
    console.error("[bot-action-watchdog] failed:", error);
    return { expired: 0 };
  }
}

export function startBotActionWatchdog() {
  const options = resolveBotActionWatchdogOptions();
  if (!Number.isFinite(options.maxProcessingHours) || options.maxProcessingHours <= 0) {
    console.info("[bot-action-watchdog] disabled (non-positive max hours)");
    return null;
  }

  const intervalMs = Math.max(options.checkIntervalMinutes, 1) * 60 * 1000;
  let stopped = false;

  const run = () => {
    runBotActionWatchdog(options).catch((error) => {
      console.error("[bot-action-watchdog] job failed:", error);
    });
  };

  const timer = setInterval(() => {
    if (!stopped) {
      run();
    }
  }, intervalMs);
  timer.unref?.();

  // Initial run (non-blocking)
  run();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}


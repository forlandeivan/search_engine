import type { BotAction, BotActionStatus } from "@shared/schema";

export type BotActionTransitionResult = {
  newState: BotAction | null;
  stateChanged: boolean;
  ignored: boolean;
  reason?: string;
};

/**
 * State machine for bot_action transitions.
 * Ensures idempotency and handles out-of-order events.
 */
export function computeBotActionTransition(
  currentState: BotAction | null,
  incomingStatus: BotActionStatus,
  incomingActionId: string,
  incomingDisplayText?: string | null,
  incomingPayload?: Record<string, unknown> | null,
): BotActionTransitionResult {
  // Out-of-order protection: update before start
  if (!currentState && (incomingStatus === "done" || incomingStatus === "error")) {
    // Option A: 404 "unknown actionId" (strict) - client must start first
    // We'll return null and let the caller handle 404
    return {
      newState: null,
      stateChanged: false,
      ignored: true,
      reason: "update_before_start",
    };
  }

  // If no current state, create new processing state
  if (!currentState) {
    // This should only happen for "processing" status (start)
    if (incomingStatus !== "processing") {
      return {
        newState: null,
        stateChanged: false,
        ignored: true,
        reason: "invalid_initial_status",
      };
    }
    // Will be created by storage layer
    return {
      newState: null,
      stateChanged: true,
      ignored: false,
    };
  }

  // Idempotency: same actionId, check transitions

  // Start (processing) rules:
  if (incomingStatus === "processing") {
    if (currentState.status === "processing") {
      // Idempotent: update displayText/payload if changed, but keep processing
      const displayTextChanged = incomingDisplayText !== undefined && incomingDisplayText !== currentState.displayText;
      const payloadChanged =
        incomingPayload !== undefined && JSON.stringify(incomingPayload) !== JSON.stringify(currentState.payload);
      if (displayTextChanged || payloadChanged) {
        return {
          newState: {
            ...currentState,
            displayText: incomingDisplayText ?? currentState.displayText,
            payload: incomingPayload ?? currentState.payload,
          },
          stateChanged: true,
          ignored: false,
        };
      }
      // No changes, idempotent no-op
      return {
        newState: currentState,
        stateChanged: false,
        ignored: true,
        reason: "idempotent_processing",
      };
    }
    // Terminal state (done/error) → don't rollback to processing
    if (currentState.status === "done" || currentState.status === "error") {
      return {
        newState: currentState,
        stateChanged: false,
        ignored: true,
        reason: "no_rollback_from_terminal",
      };
    }
  }

  // Update (done/error) rules:
  if (incomingStatus === "done" || incomingStatus === "error") {
    // From processing → done/error: allowed
    if (currentState.status === "processing") {
      return {
        newState: {
          ...currentState,
          status: incomingStatus,
          displayText: incomingDisplayText ?? currentState.displayText,
          payload: incomingPayload ?? currentState.payload,
        },
        stateChanged: true,
        ignored: false,
      };
    }

    // Terminal → same terminal: idempotent
    if (currentState.status === incomingStatus) {
      // Check if displayText/payload changed
      const displayTextChanged = incomingDisplayText !== undefined && incomingDisplayText !== currentState.displayText;
      const payloadChanged =
        incomingPayload !== undefined && JSON.stringify(incomingPayload) !== JSON.stringify(currentState.payload);
      if (displayTextChanged || payloadChanged) {
        return {
          newState: {
            ...currentState,
            displayText: incomingDisplayText ?? currentState.displayText,
            payload: incomingPayload ?? currentState.payload,
          },
          stateChanged: true,
          ignored: false,
        };
      }
      return {
        newState: currentState,
        stateChanged: false,
        ignored: true,
        reason: "idempotent_terminal",
      };
    }

    // Terminal conflict: done vs error
    // Rule: "first completion wins" (ignore later terminal states)
    if (
      (currentState.status === "done" && incomingStatus === "error") ||
      (currentState.status === "error" && incomingStatus === "done")
    ) {
      return {
        newState: currentState,
        stateChanged: false,
        ignored: true,
        reason: "terminal_conflict_first_wins",
      };
    }
  }

  // Fallback: should not reach here
  return {
    newState: currentState,
    stateChanged: false,
    ignored: true,
    reason: "unknown_transition",
  };
}

/**
 * Check if bot_action event should be published to realtime.
 * Only publish if state actually changed or displayText/payload changed.
 */
export function shouldPublishBotActionEvent(
  currentState: BotAction | null,
  newState: BotAction | null,
  transitionResult: BotActionTransitionResult,
): boolean {
  if (!transitionResult.stateChanged) {
    return false;
  }

  if (!currentState && newState) {
    // New action created
    return true;
  }

  if (!currentState || !newState) {
    return false;
  }

  // Status changed
  if (currentState.status !== newState.status) {
    return true;
  }

  // DisplayText or payload changed (even if status same)
  const displayTextChanged = currentState.displayText !== newState.displayText;
  const payloadChanged = JSON.stringify(currentState.payload) !== JSON.stringify(newState.payload);

  return displayTextChanged || payloadChanged;
}


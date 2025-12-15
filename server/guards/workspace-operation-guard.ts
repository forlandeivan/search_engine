import {
  OPERATION_TYPES,
  type GuardBlockingMode,
  type GuardDecision,
  type OperationContext,
} from "./types";
import { logGuardBlockEvent } from "./block-log-service";
import { defaultLimitRulesProvider } from "./limit-rules-provider";
import { defaultUsageSnapshotProvider } from "./usage-snapshot-provider";
import { limitEvaluator } from "./limit-evaluator";

const resolveBlockingMode = (): GuardBlockingMode => {
  const raw = (process.env.GUARD_BLOCKING_MODE || "").toUpperCase().trim();
  if (raw === "HARD" || raw === "SOFT" || raw === "DISABLED") {
    return raw;
  }
  return "DISABLED";
};

export class WorkspaceOperationGuard {
  private readonly rulesProvider = defaultLimitRulesProvider;
  private readonly usageProvider = defaultUsageSnapshotProvider;
  private readonly evaluator = limitEvaluator;
  private readonly blockingMode: GuardBlockingMode = resolveBlockingMode();

  async check(context: OperationContext): Promise<GuardDecision> {
    const { workspaceId, operationType, expectedCost } = context;
    const isKnownOperation = OPERATION_TYPES.includes(operationType);

    let snapshot: unknown = null;
    try {
      snapshot = await this.usageProvider.getSnapshot(workspaceId);
    } catch (error) {
      console.warn(
        `[guard] failed to fetch usage snapshot for workspace ${workspaceId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    let rules: unknown = [];
    try {
      rules = await this.rulesProvider.getRules(workspaceId, context);
    } catch (error) {
      console.warn(
        `[guard] failed to fetch limit rules for workspace ${workspaceId}:`,
        error instanceof Error ? error.message : String(error),
      );
      rules = [];
    }

    const evaluated = this.evaluator.evaluate({
      context,
      snapshot: (snapshot as any) ?? null,
      rules: (rules as any) ?? [],
    });

    const logPayload = {
      workspaceId,
      operationType,
      expectedCost: expectedCost ?? null,
      allowed: evaluated.allowed,
      reasonCode: evaluated.reasonCode,
      knownOperationType: isKnownOperation,
      usageSnapshot: snapshot,
      rulesCount: Array.isArray(rules) ? rules.length : 0,
      blockingMode: this.blockingMode,
    };

    // use console.debug to avoid noise in production logs
    console.debug("[guard] workspace operation decision", logPayload);

    let finalDecision: GuardDecision = {
      ...evaluated,
      debug: {
        ...(evaluated.debug ?? {}),
        operationType,
        expectedCost: expectedCost ?? null,
        usageSnapshot: snapshot,
        rulesCount: Array.isArray(rules) ? rules.length : 0,
        blockingMode: this.blockingMode,
      },
    };

    if (this.blockingMode === "DISABLED") {
      finalDecision = {
        ...finalDecision,
        allowed: true,
        reasonCode: "ALLOWED",
        resourceType: evaluated.resourceType,
        message: "Guard blocking disabled (mode=DISABLED)",
      };
    } else if (this.blockingMode === "SOFT" && !evaluated.allowed) {
      await logGuardBlockEvent(evaluated, context, snapshot as any, { isSoft: true });
      finalDecision = {
        ...finalDecision,
        allowed: true,
        reasonCode: "ALLOWED",
        message: "Guard in SOFT mode — operation allowed (would block)",
        debug: {
          ...(finalDecision.debug ?? {}),
          softBlocked: true,
        },
      };
    } else if (this.blockingMode === "HARD" && !evaluated.allowed) {
      await logGuardBlockEvent(evaluated, context, snapshot as any, { isSoft: false });
    }

    return finalDecision;
  }
}

export const workspaceOperationGuard = new WorkspaceOperationGuard();

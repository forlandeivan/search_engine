import type {
  ExpectedCost,
  GuardDecision,
  LimitCheckResult,
  LimitKey,
  LimitRule,
  OperationContext,
  ResourceType,
} from "./types";
import type { UsageSnapshot } from "./usage-snapshot-provider";

type EvaluationInput = {
  context: OperationContext;
  snapshot: UsageSnapshot | null;
  rules: LimitRule[];
};

const EMPTY_SNAPSHOT: UsageSnapshot = {
  workspaceId: "",
  periodCode: "",
  llmTokensTotal: 0,
  embeddingsTokensTotal: 0,
  asrMinutesTotal: 0,
  storageBytesTotal: 0,
  skillsCount: 0,
  actionsCount: 0,
  knowledgeBasesCount: 0,
  membersCount: 0,
  qdrantStorageBytes: 0,
  qdrantCollectionsCount: 0,
  qdrantPointsCount: 0,
};

function matchesRule(rule: LimitRule, context: OperationContext): boolean {
  const applies = rule.appliesTo;
  if (!applies) return true;

  if (applies.operationType && applies.operationType !== context.operationType) {
    return false;
  }

  if (applies.scenario) {
    const scenario =
      context.meta?.llm?.scenario ??
      context.meta?.embeddings?.scenario ??
      context.meta?.asr?.mediaType ??
      context.meta?.storage?.category ??
      context.meta?.objects?.entityType;
    if (scenario && scenario !== applies.scenario) {
      return false;
    }
  }

  if (applies.provider) {
    const provider = context.meta?.llm?.provider ?? context.meta?.embeddings?.provider ?? context.meta?.asr?.provider;
    if (provider && provider !== applies.provider) {
      return false;
    }
  }

  if (applies.model) {
    const model = context.meta?.llm?.model ?? context.meta?.embeddings?.model ?? context.meta?.asr?.model;
    if (model && model !== applies.model) {
      return false;
    }
  }

  if (applies.modelId) {
    const modelId = context.meta?.llm?.modelId ?? context.meta?.embeddings?.modelId ?? context.meta?.asr?.modelId;
    if (modelId && modelId !== applies.modelId) {
      return false;
    }
  }

  if (applies.modelKey) {
    const modelKey = context.meta?.llm?.modelKey ?? context.meta?.embeddings?.modelKey ?? context.meta?.asr?.modelKey;
    if (modelKey && modelKey !== applies.modelKey) {
      return false;
    }
  }

  return true;
}

function getCurrentValue(limitKey: LimitKey, snapshot: UsageSnapshot): { current: number; unit: LimitRule["unit"] } {
  switch (limitKey) {
    case "TOKEN_LLM":
      return { current: snapshot.llmTokensTotal ?? 0, unit: "tokens" };
    case "TOKEN_EMBEDDINGS":
      return { current: snapshot.embeddingsTokensTotal ?? 0, unit: "tokens" };
    case "ASR_MINUTES":
      return { current: snapshot.asrMinutesTotal ?? 0, unit: "minutes" };
    case "STORAGE_BYTES":
      return { current: snapshot.storageBytesTotal ?? 0, unit: "bytes" };
    case "OBJECT_SKILLS":
      return { current: snapshot.skillsCount ?? 0, unit: "count" };
    case "OBJECT_KNOWLEDGE_BASES":
      return { current: snapshot.knowledgeBasesCount ?? 0, unit: "count" };
    case "OBJECT_ACTIONS":
      return { current: snapshot.actionsCount ?? 0, unit: "count" };
    case "OBJECT_MEMBERS":
      return { current: snapshot.membersCount ?? 0, unit: "count" };
    case "QDRANT_BYTES":
      return { current: snapshot.qdrantStorageBytes ?? 0, unit: "bytes" };
    default:
      return { current: 0, unit: "count" };
  }
}

function getDelta(limitKey: LimitKey, expectedCost?: ExpectedCost | null): number {
  if (!expectedCost) return 0;
  switch (limitKey) {
    case "TOKEN_LLM":
    case "TOKEN_EMBEDDINGS":
      return Number(expectedCost.tokens ?? 0);
    case "ASR_MINUTES": {
      const seconds = Number(expectedCost.seconds ?? 0);
      return seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 0;
    }
    case "STORAGE_BYTES":
    case "QDRANT_BYTES":
      return Number(expectedCost.bytes ?? 0);
    case "OBJECT_SKILLS":
    case "OBJECT_KNOWLEDGE_BASES":
    case "OBJECT_ACTIONS":
    case "OBJECT_MEMBERS":
      return Number(expectedCost.objects ?? 0);
    default:
      return 0;
  }
}

function buildDecisionForLimit(rule: LimitRule, result: LimitCheckResult, resourceType: ResourceType): GuardDecision {
  const attempted = result.predicted;
  return {
    allowed: false,
    reasonCode: "USAGE_LIMIT_REACHED",
    resourceType,
    message: `Превышен лимит ${rule.limitKey.toLowerCase()}: ${attempted} / ${rule.limitValue}`,
    upgradeAvailable: rule.upgradeAvailable ?? false,
    limitsHint: {
      current: attempted,
      limit: rule.limitValue,
      unit: rule.unit,
      limitKey: rule.limitKey,
    },
    debug: {
      limitKey: rule.limitKey,
      rule,
      check: { ...result, attempted },
    },
  };
}

export class LimitEvaluator {
  evaluate({ context, snapshot, rules }: EvaluationInput): GuardDecision {
    const safeSnapshot = snapshot ?? EMPTY_SNAPSHOT;
    const applicable = rules.filter((rule) => matchesRule(rule, context));

    for (const rule of applicable) {
      if (rule.limitValue === null || rule.limitValue === undefined) {
        continue; // unlimited
      }

      const { current, unit } = getCurrentValue(rule.limitKey, safeSnapshot);
      const delta = getDelta(rule.limitKey, context.expectedCost);
      const predicted = current + delta;

      const check: LimitCheckResult = {
        exceeded: predicted >= rule.limitValue,
        current,
        predicted,
        limit: rule.limitValue,
        limitKey: rule.limitKey,
        unit,
      };

      if (check.exceeded) {
        return buildDecisionForLimit(rule, check, rule.resourceType);
      }
    }

    return {
      allowed: true,
      reasonCode: "ALLOWED",
      resourceType: null,
      message: "Operation allowed by limits (no exceeded rules)",
      upgradeAvailable: false,
      debug: {
        appliedRules: applicable.map((rule) => rule.limitKey),
      },
    };
  }
}

export const limitEvaluator = new LimitEvaluator();

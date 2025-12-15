import { LIMIT_KEYS, type LimitKey, type LimitRule, type LimitRulesProvider, type OperationContext, type OperationType, type ResourceType } from "./types";
import { workspacePlanService } from "../workspace-plan-service";

const LIMIT_KEY_SET = new Set<string>(LIMIT_KEYS);

function mapLimitKeyToResourceType(limitKey: LimitKey): ResourceType {
  switch (limitKey) {
    case "TOKEN_LLM":
      return "tokens";
    case "TOKEN_EMBEDDINGS":
      return "embeddings";
    case "ASR_MINUTES":
      return "asr";
    case "STORAGE_BYTES":
    case "QDRANT_BYTES":
      return "storage";
    case "OBJECT_SKILLS":
    case "OBJECT_KNOWLEDGE_BASES":
    case "OBJECT_ACTIONS":
    case "OBJECT_MEMBERS":
      return "objects";
    default:
      return "other";
  }
}

function mapLimitKeyToOperation(limitKey: LimitKey): OperationType | undefined {
  switch (limitKey) {
    case "TOKEN_LLM":
      return "LLM_REQUEST";
    case "TOKEN_EMBEDDINGS":
      return "EMBEDDINGS";
    case "ASR_MINUTES":
      return "ASR_TRANSCRIPTION";
    case "STORAGE_BYTES":
      return "STORAGE_UPLOAD";
    case "OBJECT_SKILLS":
      return "CREATE_SKILL";
    case "OBJECT_KNOWLEDGE_BASES":
      return "CREATE_KNOWLEDGE_BASE";
    case "OBJECT_ACTIONS":
      return "CREATE_ACTION";
    case "OBJECT_MEMBERS":
      return "INVITE_WORKSPACE_MEMBER";
    case "QDRANT_BYTES":
      return undefined;
    default:
      return undefined;
  }
}

function isLimitKey(value: string): value is LimitKey {
  return LIMIT_KEY_SET.has(value);
}

class TariffLimitRulesProvider implements LimitRulesProvider {
  async getRules(workspaceId: string, _context: OperationContext): Promise<LimitRule[]> {
    const planWithLimits = await workspacePlanService.getWorkspacePlanWithLimits(workspaceId);
    const rules: LimitRule[] = [];

    for (const [rawKey, limit] of Object.entries(planWithLimits.limits ?? {})) {
      if (!isLimitKey(rawKey)) {
        console.warn("[tariff-limit-rules] unknown limit_key from plan, skipping", rawKey);
        continue;
      }

      if (limit?.isEnabled === false) continue;

      const resourceType = mapLimitKeyToResourceType(rawKey);
      const operationType = mapLimitKeyToOperation(rawKey);

      rules.push({
        limitKey: rawKey,
        resourceType,
        unit: (limit?.unit as LimitRule["unit"]) ?? "count",
        limitValue: limit?.value ?? null,
        scope: "workspace",
        appliesTo: operationType ? { operationType } : undefined,
        upgradeAvailable: planWithLimits.code === "FREE",
      });
    }

    return rules;
  }
}

export const tariffLimitRulesProvider = new TariffLimitRulesProvider();

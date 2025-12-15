import { db } from "./db";
import { tariffLimits, tariffPlans } from "@shared/schema";
import { LIMIT_KEYS, type LimitKey } from "./guards/types";
import { eq } from "drizzle-orm";

type TariffSeedConfig = {
  code: string;
  name: string;
  description?: string | null;
  limits: Array<{
    key: LimitKey;
    unit: "tokens" | "bytes" | "minutes" | "count";
    value: number | null;
  }>;
};

const ONE_MB = 1024 * 1024;
const ONE_GB = ONE_MB * 1024;

export const DEFAULT_TARIFFS: TariffSeedConfig[] = [
  {
    code: "FREE",
    name: "Free",
    description: "Базовый бесплатный тариф",
    limits: [
      { key: "TOKEN_LLM", unit: "tokens", value: 100_000 },
      { key: "TOKEN_EMBEDDINGS", unit: "tokens", value: 200_000 },
      { key: "ASR_MINUTES", unit: "minutes", value: 60 },
      { key: "STORAGE_BYTES", unit: "bytes", value: ONE_GB },
      { key: "OBJECT_SKILLS", unit: "count", value: 3 },
      { key: "OBJECT_ACTIONS", unit: "count", value: 20 },
      { key: "OBJECT_KNOWLEDGE_BASES", unit: "count", value: 2 },
      { key: "OBJECT_MEMBERS", unit: "count", value: 1 },
      { key: "QDRANT_BYTES", unit: "bytes", value: ONE_GB },
    ],
  },
  {
    code: "PRO",
    name: "Pro",
    description: "Расширенный тариф для активных команд",
    limits: [
      { key: "TOKEN_LLM", unit: "tokens", value: 1_000_000 },
      { key: "TOKEN_EMBEDDINGS", unit: "tokens", value: 2_000_000 },
      { key: "ASR_MINUTES", unit: "minutes", value: 600 },
      { key: "STORAGE_BYTES", unit: "bytes", value: 50 * ONE_GB },
      { key: "OBJECT_SKILLS", unit: "count", value: 50 },
      { key: "OBJECT_ACTIONS", unit: "count", value: 500 },
      { key: "OBJECT_KNOWLEDGE_BASES", unit: "count", value: 20 },
      { key: "OBJECT_MEMBERS", unit: "count", value: 20 },
      { key: "QDRANT_BYTES", unit: "bytes", value: 50 * ONE_GB },
    ],
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Гибкий корпоративный тариф",
    limits: [
      { key: "TOKEN_LLM", unit: "tokens", value: null },
      { key: "TOKEN_EMBEDDINGS", unit: "tokens", value: null },
      { key: "ASR_MINUTES", unit: "minutes", value: null },
      { key: "STORAGE_BYTES", unit: "bytes", value: null },
      { key: "OBJECT_SKILLS", unit: "count", value: null },
      { key: "OBJECT_ACTIONS", unit: "count", value: null },
      { key: "OBJECT_KNOWLEDGE_BASES", unit: "count", value: null },
      { key: "OBJECT_MEMBERS", unit: "count", value: null },
      { key: "QDRANT_BYTES", unit: "bytes", value: null },
    ],
  },
];

async function upsertPlan(code: string, name: string, description?: string | null): Promise<string> {
  const [existing] = await db.select().from(tariffPlans).where(eq(tariffPlans.code, code)).limit(1);
  if (existing) {
    return existing.id;
  }

  const [created] = await db
    .insert(tariffPlans)
    .values({ code, name, description: description ?? null, isActive: true })
    .returning({ id: tariffPlans.id });

  console.log(`[tariff-seed] created plan ${code}`);
  return created.id;
}

async function upsertLimit(planId: string, key: LimitKey, unit: string, value: number | null): Promise<void> {
  const [existing] = await db
    .select({ id: tariffLimits.id })
    .from(tariffLimits)
    .where(eq(tariffLimits.planId, planId))
    .where(eq(tariffLimits.limitKey, key))
    .limit(1);

  if (existing) {
    return;
  }

  await db.insert(tariffLimits).values({
    planId,
    limitKey: key,
    unit,
    limitValue: value,
    isEnabled: true,
  });
  console.log(`[tariff-seed] created limit ${key} for plan ${planId}`);
}

export async function seedDefaultTariffs(): Promise<void> {
  for (const plan of DEFAULT_TARIFFS) {
    const planId = await upsertPlan(plan.code, plan.name, plan.description);
    for (const limit of plan.limits) {
      await upsertLimit(planId, limit.key, limit.unit, limit.value);
    }
  }
}

if (require.main === module) {
  seedDefaultTariffs()
    .then(() => {
      console.log("[tariff-seed] completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[tariff-seed] failed", err);
      process.exit(1);
    });
}

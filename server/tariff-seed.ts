import { db } from "./db";
import { tariffLimits, tariffPlans } from "@shared/schema";
import { LIMIT_KEYS, type LimitKey } from "./guards/types";
import { eq, and } from "drizzle-orm";
import { fileURLToPath } from "url";

type TariffSeedConfig = {
  code: string;
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  sortOrder?: number;
  limits: Array<{
    key: LimitKey;
    unit: "tokens" | "bytes" | "minutes" | "count";
    value: number | null;
  }>;
};

const ONE_MB = 1024 * 1024;
const ONE_GB = ONE_MB * 1024;

const LIMIT_UNITS: Record<LimitKey, TariffSeedConfig["limits"][number]["unit"]> = {
  TOKEN_LLM: "tokens",
  TOKEN_EMBEDDINGS: "tokens",
  ASR_MINUTES: "minutes",
  STORAGE_BYTES: "bytes",
  OBJECT_SKILLS: "count",
  OBJECT_ACTIONS: "count",
  OBJECT_KNOWLEDGE_BASES: "count",
  OBJECT_MEMBERS: "count",
  QDRANT_BYTES: "bytes",
};

const FREE_LIMIT_VALUES: Record<LimitKey, number | null> = {
  TOKEN_LLM: 0,
  TOKEN_EMBEDDINGS: 0,
  ASR_MINUTES: 0,
  STORAGE_BYTES: 1 * ONE_GB,
  OBJECT_SKILLS: 3,
  OBJECT_ACTIONS: 20,
  OBJECT_KNOWLEDGE_BASES: 2,
  OBJECT_MEMBERS: 1,
  QDRANT_BYTES: 1 * ONE_GB,
};

function makeLimits(values: Record<LimitKey, number | null>): TariffSeedConfig["limits"] {
  return (Object.keys(values) as LimitKey[]).map((key) => ({
    key,
    unit: LIMIT_UNITS[key],
    value: values[key],
  }));
}

const ENTERPRISE_LIMIT_VALUES = (Object.keys(FREE_LIMIT_VALUES) as LimitKey[]).reduce(
  (acc, key) => ({ ...acc, [key]: null }),
  {} as Record<LimitKey, number | null>,
);

export const DEFAULT_TARIFFS: TariffSeedConfig[] = [
  {
    code: "FREE",
    name: "Free",
    description: "Базовый бесплатный тариф",
    shortDescription: "Бесплатно для тестов и малого использования",
    sortOrder: 1,
    limits: makeLimits(FREE_LIMIT_VALUES),
  },
  {
    code: "PRO",
    name: "Pro",
    description: "Расширенный тариф для активных команд",
    shortDescription: "Больше лимитов для рабочих команд",
    sortOrder: 2,
    limits: makeLimits(FREE_LIMIT_VALUES), // значения настраивает админ; структура совпадает с Free
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Гибкий корпоративный тариф",
    shortDescription: "Индивидуальные лимиты и условия",
    sortOrder: 3,
    limits: makeLimits(ENTERPRISE_LIMIT_VALUES),
  },
];

async function upsertPlan(
  code: string,
  name: string,
  description?: string | null,
  shortDescription?: string | null,
  sortOrder?: number,
): Promise<string> {
  const [existing] = await db.select().from(tariffPlans).where(eq(tariffPlans.code, code)).limit(1);
  if (existing) {
    // keep existing, do not overwrite admin edits except optional sort order
    if (typeof sortOrder === "number") {
      await db.update(tariffPlans).set({ sortOrder }).where(eq(tariffPlans.id, existing.id));
    }
    return existing.id;
  }

  const [created] = await db
    .insert(tariffPlans)
    .values({
      code,
      name,
      description: description ?? null,
      shortDescription: shortDescription ?? description ?? null,
      sortOrder: sortOrder ?? 0,
      isActive: true,
    })
    .returning({ id: tariffPlans.id });

  console.log(`[tariff-seed] created plan ${code}`);
  return created.id;
}

async function upsertLimit(planId: string, key: LimitKey, unit: string, value: number | null): Promise<void> {
  const [existing] = await db
    .select({ id: tariffLimits.id })
    .from(tariffLimits)
    .where(and(
      eq(tariffLimits.planId, planId),
      eq(tariffLimits.limitKey, key)
    ))
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
    const planId = await upsertPlan(plan.code, plan.name, plan.description, plan.shortDescription, plan.sortOrder);
    for (const limit of plan.limits) {
      await upsertLimit(planId, limit.key, limit.unit, limit.value);
    }
  }
}

// Export for programmatic use
// For standalone execution, use: npm run seed:tariffs

#!/usr/bin/env ts-node
import "dotenv/config";
import { sql, eq, and, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { skills, skillKnowledgeBases } from "@shared/schema";

async function main() {
  const standardSkillIds = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.mode, "llm"));

  const ids = standardSkillIds.map((row) => row.id);
  const total = ids.length;
  console.info(`[cleanup-legacy-rag] standard skills found: ${total}`);

  if (total > 0) {
    await db
      .update(skills)
      .set({
        ragMode: "all_collections",
        ragCollectionIds: sql`'[]'::jsonb`,
        ragTopK: 5,
        ragMinScore: 0.7,
        ragMaxContextTokens: null,
        ragShowSources: true,
        ragBm25Weight: null,
        ragBm25Limit: null,
        ragVectorWeight: null,
        ragVectorLimit: null,
        ragEmbeddingProviderId: null,
        ragLlmTemperature: null,
        ragLlmMaxTokens: null,
        ragLlmResponseFormat: null,
      })
      .where(eq(skills.mode, "llm"));

    if (ids.length > 0) {
      await db.delete(skillKnowledgeBases).where(inArray(skillKnowledgeBases.skillId, ids));
    }
  }

  console.info("[cleanup-legacy-rag] cleanup completed", { affectedSkills: total });
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[cleanup-legacy-rag] failed", error);
    process.exit(1);
  });


import { z } from "zod";

export const indexingRulesSchema = z.object({
  embeddingsProvider: z.string().trim().min(1, "Укажите провайдера эмбеддингов").max(255),
  embeddingsModel: z.string().trim().min(1, "Укажите модель эмбеддингов").max(255),
  chunkSize: z.number().int().positive("chunkSize должно быть > 0"),
  chunkOverlap: z.number().int().min(0, "chunkOverlap должно быть >= 0"),
  topK: z.number().int().positive("topK должно быть > 0"),
  relevanceThreshold: z.number().min(0, "relevanceThreshold должно быть от 0 до 1").max(1, "relevanceThreshold должно быть от 0 до 1"),
  citationsEnabled: z.boolean(),
});

export const updateIndexingRulesSchema = indexingRulesSchema
  .partial()
  .refine(
    (value) => {
      if (value.chunkSize === undefined || value.chunkOverlap === undefined) {
        return true;
      }
      return value.chunkOverlap < value.chunkSize;
    },
    {
      message: "chunkOverlap должно быть меньше chunkSize",
      path: ["chunkOverlap"],
    },
  );

export type IndexingRulesDto = z.infer<typeof indexingRulesSchema>;
export type UpdateIndexingRulesDto = z.infer<typeof updateIndexingRulesSchema>;

export const DEFAULT_INDEXING_RULES: IndexingRulesDto = {
  embeddingsProvider: "openai",
  embeddingsModel: "text-embedding-3-small",
  chunkSize: 800,
  chunkOverlap: 200,
  topK: 6,
  relevanceThreshold: 0.5,
  citationsEnabled: false,
};

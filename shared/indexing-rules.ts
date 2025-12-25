import { z } from "zod";

export const MIN_CHUNK_SIZE = 200;
export const MAX_CHUNK_SIZE = 8_000;
export const MIN_TOP_K = 1;
export const MAX_TOP_K = 20;
export const MIN_RELEVANCE_THRESHOLD = 0;
export const MAX_RELEVANCE_THRESHOLD = 1;

export const indexingRulesSchema = z.object({
  embeddingsProvider: z.string().trim().min(1, "Укажите провайдера эмбеддингов").max(255),
  embeddingsModel: z.string().trim().min(1, "Укажите модель эмбеддингов").max(255),
  chunkSize: z
    .number()
    .int()
    .min(MIN_CHUNK_SIZE, `Размер чанка должен быть не меньше ${MIN_CHUNK_SIZE}`)
    .max(MAX_CHUNK_SIZE, `Размер чанка должен быть не больше ${MAX_CHUNK_SIZE}`),
  chunkOverlap: z.number().int().min(0, "chunkOverlap должно быть >= 0"),
  topK: z
    .number()
    .int()
    .min(MIN_TOP_K, `topK должно быть не меньше ${MIN_TOP_K}`)
    .max(MAX_TOP_K, `topK должно быть не больше ${MAX_TOP_K}`),
  relevanceThreshold: z
    .number()
    .min(MIN_RELEVANCE_THRESHOLD, `relevanceThreshold должно быть от ${MIN_RELEVANCE_THRESHOLD} до ${MAX_RELEVANCE_THRESHOLD}`)
    .max(MAX_RELEVANCE_THRESHOLD, `relevanceThreshold должно быть от ${MIN_RELEVANCE_THRESHOLD} до ${MAX_RELEVANCE_THRESHOLD}`),
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
  citationsEnabled: true,
};

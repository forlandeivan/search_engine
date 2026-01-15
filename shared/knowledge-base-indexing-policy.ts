import { z } from "zod";
import { collectionFieldTypes, type CollectionSchemaFieldInput } from "./vectorization";

export const MIN_CHUNK_SIZE = 200;
export const MAX_CHUNK_SIZE = 8_000;

export const collectionSchemaFieldSchema = z.object({
  name: z.string().trim().min(1, "Название поля обязательно"),
  type: z.enum(collectionFieldTypes, {
    errorMap: () => ({ message: "Недопустимый тип поля" }),
  }),
  isArray: z.boolean(),
  template: z.string(),
});

export const knowledgeBaseIndexingPolicySchema = z.object({
  embeddingsProvider: z.string().trim().min(1, "Укажите провайдера эмбеддингов").max(255),
  embeddingsModel: z.string().trim().min(1, "Укажите модель эмбеддингов").max(255),
  chunkSize: z
    .number()
    .int()
    .min(MIN_CHUNK_SIZE, `Размер чанка должен быть не меньше ${MIN_CHUNK_SIZE}`)
    .max(MAX_CHUNK_SIZE, `Размер чанка должен быть не больше ${MAX_CHUNK_SIZE}`),
  chunkOverlap: z.number().int().min(0, "chunkOverlap должно быть >= 0"),
  defaultSchema: z.array(collectionSchemaFieldSchema),
});

export const updateKnowledgeBaseIndexingPolicySchema = knowledgeBaseIndexingPolicySchema
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

export type KnowledgeBaseIndexingPolicyDto = z.infer<typeof knowledgeBaseIndexingPolicySchema> & {
  policyHash?: string | null;
};
export type UpdateKnowledgeBaseIndexingPolicyDto = z.infer<typeof updateKnowledgeBaseIndexingPolicySchema>;

export const DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY: KnowledgeBaseIndexingPolicyDto = {
  embeddingsProvider: "openai",
  embeddingsModel: "text-embedding-3-small",
  chunkSize: 800,
  chunkOverlap: 200,
  policyHash: null,
  defaultSchema: [
    { name: "content", type: "string", isArray: false, template: "{{ chunk.text }}" },
    {
      name: "title",
      type: "string",
      isArray: false,
      template: "{{ chunk.heading | default: document.title }}",
    },
    {
      name: "url",
      type: "string",
      isArray: false,
      template: "{{ chunk.deepLink | default: document.path }}",
    },
    { name: "chunk_id", type: "string", isArray: false, template: "{{ chunk.id }}" },
    { name: "chunk_index", type: "double", isArray: false, template: "{{ chunk.index }}" },
  ],
};


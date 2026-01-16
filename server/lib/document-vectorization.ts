/**
 * Document Vectorization Module
 * 
 * Handles knowledge document vectorization - converting documents to embeddings
 * and storing them in vector database.
 */

import { z } from 'zod';

/**
 * This module provides schemas, types and helper functions for document vectorization.
 * The actual endpoint implementation is in vector.routes.ts.
 */

// ============================================================================
// Constants
// ============================================================================

export const MIN_CHUNK_SIZE = 100;
export const MAX_CHUNK_SIZE = 8000;
export const KNOWLEDGE_DOCUMENT_PAYLOAD_TEXT_LIMIT = 16_000;
export const KNOWLEDGE_DOCUMENT_PAYLOAD_HTML_LIMIT = 32_000;

// ============================================================================
// Schemas
// ============================================================================

export const knowledgeDocumentChunkItemSchema = z.object({
  id: z.string().optional(),
  text: z.string().optional(),
  content: z.string().optional(),
  index: z.number().int().min(0).optional(),
  charStart: z.number().int().min(0).optional(),
  start: z.number().int().min(0).optional(),
  charEnd: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
  tokenCount: z.number().int().min(0).optional(),
  vectorRecordId: z.union([z.string(), z.number()]).optional(),
});

export const knowledgeDocumentChunksSchema = z.object({
  items: z.array(knowledgeDocumentChunkItemSchema),
  totalCount: z.number().int().min(0).optional(),
  chunkSetId: z.string().optional(),
  config: z.object({
    maxChars: z.number().int().min(0).optional(),
    maxTokens: z.number().int().min(0).optional(),
    overlapChars: z.number().int().min(0).optional(),
    overlapTokens: z.number().int().min(0).optional(),
  }).optional(),
});

export const vectorizeCollectionSchemaFieldSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название поля'),
  type: z.enum(['string', 'integer', 'float', 'boolean', 'text', 'keyword', 'datetime', 'geo']),
  isArray: z.boolean().optional(),
  template: z.string().optional(),
});

export const vectorizeCollectionSchemaSchema = z.object({
  fields: z.array(vectorizeCollectionSchemaFieldSchema).min(1).optional(),
});

export const vectorizePageSchema = z.object({
  embeddingProviderId: z.string().trim().optional(),
  collectionName: z.string().trim().min(1, 'Укажите название коллекции').optional(),
  createCollection: z.boolean().optional(),
  schema: vectorizeCollectionSchemaSchema.optional(),
});

export const vectorizeKnowledgeDocumentSchema = vectorizePageSchema.extend({
  document: z.object({
    id: z.string().trim().min(1, 'Укажите идентификатор документа'),
    title: z.string().optional().nullable(),
    text: z.string().trim().min(1, 'Документ не может быть пустым'),
    html: z.string().optional().nullable(),
    path: z.string().optional().nullable(),
    sourceUrl: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
    charCount: z.number().int().min(0).optional(),
    wordCount: z.number().int().min(0).optional(),
    excerpt: z.string().optional().nullable(),
    chunks: knowledgeDocumentChunksSchema.optional(),
  }),
  base: z.object({
    id: z.string().trim().min(1, 'Укажите идентификатор библиотеки'),
    name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
  }).optional().nullable(),
  chunkSize: z.coerce.number().int().min(MIN_CHUNK_SIZE).max(MAX_CHUNK_SIZE).default(800),
  chunkOverlap: z.coerce.number().int().min(0).max(4000).default(0),
});

export type VectorizeKnowledgeDocumentInput = z.infer<typeof vectorizeKnowledgeDocumentSchema>;

// ============================================================================
// Types
// ============================================================================

export interface KnowledgeDocumentChunk {
  id?: string;
  content: string;
  index: number;
  start: number;
  end: number;
  charCount: number;
  wordCount: number;
  tokenCount: number;
  excerpt: string;
  vectorRecordId?: string | null;
}

export interface CollectionSchemaFieldInput {
  name: string;
  type: string;
  isArray: boolean;
  template: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function normalizeDocumentText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countPlainTextWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words.filter(w => w.length > 0).length;
}

export function buildDocumentExcerpt(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const truncated = normalized.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.6) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}

export function createKnowledgeDocumentChunks(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): KnowledgeDocumentChunk[] {
  const chunks: KnowledgeDocumentChunk[] = [];
  const step = Math.max(1, chunkSize - chunkOverlap);
  let position = 0;
  let index = 0;

  while (position < text.length) {
    const end = Math.min(position + chunkSize, text.length);
    const content = text.slice(position, end);
    
    if (content.trim().length > 0) {
      chunks.push({
        content,
        index,
        start: position,
        end,
        charCount: content.length,
        wordCount: countPlainTextWords(content),
        tokenCount: Math.ceil(content.length / 4), // Rough estimate
        excerpt: buildDocumentExcerpt(content),
      });
      index++;
    }
    
    position += step;
  }

  return chunks;
}

export function truncatePayloadValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

export function normalizePointId(id: string): string | number {
  // Try to parse as UUID
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(id)) {
    return id;
  }
  
  // Try to parse as number
  const numericId = parseInt(id, 10);
  if (!isNaN(numericId) && numericId.toString() === id) {
    return numericId;
  }
  
  // Return as-is (will be hashed by Qdrant if needed)
  return id;
}

export function removeUndefinedDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedDeep);
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = removeUndefinedDeep(value);
      }
    }
    return result;
  }
  
  return obj;
}

export function buildKnowledgeCollectionName(
  base: { id: string; name?: string | null } | null,
  provider: { id: string; name?: string },
  workspaceId: string,
): string {
  if (base?.id) {
    return `kb-${base.id}`;
  }
  return `ws-${workspaceId}-emb-${provider.id}`;
}

export function extractEmbeddingTokenLimit(provider: { qdrantConfig?: { maxTokens?: unknown } | null } | any): number | null {
  const maxTokens = provider?.qdrantConfig?.maxTokens;
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    return maxTokens;
  }
  return null;
}

export function buildCustomPayloadFromSchema(
  fields: CollectionSchemaFieldInput[],
  context: Record<string, unknown>,
): Record<string, unknown> | null {
  if (fields.length === 0) {
    return null;
  }
  
  const result: Record<string, unknown> = {};
  
  for (const field of fields) {
    const template = field.template || `{{${field.name}}}`;
    // Simple template replacement - in production this would use a proper template engine
    let value: unknown = template;
    
    if (template.startsWith('{{') && template.endsWith('}}')) {
      const path = template.slice(2, -2).trim();
      const parts = path.split('.');
      let current: unknown = context;
      
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          current = undefined;
          break;
        }
      }
      
      value = current;
    }
    
    if (value !== undefined) {
      result[field.name] = value;
    }
  }
  
  return result;
}

export function tokensToUnits(tokens: number): { raw: number; units: number } {
  const raw = tokens;
  const units = Math.ceil(tokens / 1000);
  return { raw, units };
}

export function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

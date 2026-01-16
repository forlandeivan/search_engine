/**
 * RAG Pipeline Module
 * 
 * Re-exports the RAG pipeline function for use in modular routes.
 * The actual implementation remains in routes.ts for now.
 */

import type { Request } from 'express';
import type { RunKnowledgeBaseRagPipeline, RagPipelineStream, KnowledgeRagRequestPayload } from '../chat-rag';

// This will be set by routes.ts during initialization
let ragPipelineImpl: RunKnowledgeBaseRagPipeline | null = null;

/**
 * Sets the RAG pipeline implementation
 * Called from routes.ts during initialization
 */
export function setRagPipelineImpl(impl: RunKnowledgeBaseRagPipeline): void {
  ragPipelineImpl = impl;
}

/**
 * Runs the knowledge base RAG pipeline
 * Delegates to the implementation set by routes.ts
 */
export async function runKnowledgeBaseRagPipeline(options: {
  req: Request;
  body: KnowledgeRagRequestPayload;
  stream?: RagPipelineStream | null;
}): Promise<unknown> {
  if (!ragPipelineImpl) {
    throw new Error('RAG pipeline not initialized. setRagPipelineImpl must be called first.');
  }
  return ragPipelineImpl(options);
}

// Re-export types
export type { RunKnowledgeBaseRagPipeline, RagPipelineStream, KnowledgeRagRequestPayload };

export interface SuggestResponseSection {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_title: string | null;
  snippet: string;
  score: number;
  source?: string;
  breadcrumbs?: string[];
  version?: string | null;
  language?: string | null;
  url?: string | null;
}

export interface SuggestResponsePayload {
  query: string;
  kb_id: string;
  normalized_query: string;
  ask_ai: { label: string; query: string };
  sections: SuggestResponseSection[];
  timings?: { total_ms?: number };
}

export interface RagChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_title: string | null;
  snippet: string;
  text?: string;
  score: number;
  scores?: { bm25?: number; vector?: number };
}

export interface RagResponsePayload {
  query: string;
  kb_id: string;
  normalized_query: string;
  answer: string;
  citations: RagChunk[];
  chunks?: RagChunk[];
  usage?: { embeddingTokens?: number | null; llmTokens?: number | null };
  timings?: {
    total_ms?: number;
    retrieval_ms?: number;
    bm25_ms?: number;
    vector_ms?: number;
    llm_ms?: number;
  };
  debug?: { vectorSearch?: Array<Record<string, unknown>> | null };
}

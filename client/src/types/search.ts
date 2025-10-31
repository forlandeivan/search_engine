export interface SuggestResponseItem {
  id: string;
  url: string;
  title: string;
  heading_text?: string | null;
  breadcrumbs: string[];
  snippet_html: string;
  version?: string | null;
  language?: string | null;
  type?: string | null;
  path?: string | null;
  icon?: string | null;
  score?: number | null;
  docId?: string | null;
  chunkId?: string | null;
  anchor?: string | null;
}

export interface SuggestResponseGroup {
  id: string;
  title: string;
  items: SuggestResponseItem[];
  hasMore?: boolean;
}

export interface SuggestResponseMeta {
  timing_ms?: number;
  total_found?: number;
}

export interface SuggestResponsePayload {
  query: string;
  groups: SuggestResponseGroup[];
  meta?: SuggestResponseMeta;
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

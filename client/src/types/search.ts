export interface SuggestResponseItem {
  id: string;
  url?: string;
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

export interface SuggestResponseSection {
  chunk_id?: string | null;
  doc_id?: string | null;
  doc_title?: string | null;
  section_title?: string | null;
  snippet?: string | null;
  snippet_html?: string | null;
  text?: string | null;
  score?: number | null;
  source?: string | null;
  url?: string | null;
  breadcrumbs?: string[] | null;
  node_id?: string | null;
  node_slug?: string | null;
}

export interface SuggestResponseAskAi {
  label?: string | null;
  query?: string | null;
}

export interface SuggestResponseTimings {
  total_ms?: number | null;
  bm25_ms?: number | null;
  vector_ms?: number | null;
  retrieval_ms?: number | null;
}

export interface SuggestResponsePayload {
  query: string;
  groups?: SuggestResponseGroup[];
  sections?: SuggestResponseSection[];
  kb_id?: string;
  normalized_query?: string;
  ask_ai?: SuggestResponseAskAi | null;
  timings?: SuggestResponseTimings | null;
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
  node_id?: string | null;
}

export interface RagContextEntry {
  id?: string | number | null;
  score?: number | null;
  payload?: Record<string, unknown> | null;
  shard_key?: string | null;
  order_value?: number | null;
}

export interface RagResponsePayload {
  answer: string;
  format?: "text" | "markdown" | "html";
  query?: string;
  kb_id?: string;
  normalized_query?: string;
  citations: RagChunk[];
  chunks?: RagChunk[];
  context?: RagContextEntry[];
  usage?: { embeddingTokens?: number | null; llmTokens?: number | null };
  timings?: {
    total_ms?: number;
    retrieval_ms?: number;
    bm25_ms?: number;
    vector_ms?: number;
    llm_ms?: number;
  };
  provider?: { id?: string; name?: string; model?: string; modelLabel?: string | null };
  embeddingProvider?: { id?: string; name?: string };
  collection?: string;
  queryVector?: number[];
  vectorLength?: number | null;
  debug?: { vectorSearch?: Array<Record<string, unknown>> | null };
}

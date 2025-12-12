# Workspace usage foundation (step 1)

Scope: record the current data sources and fix decisions on where the single source of truth for workspace usage will live before adding migrations.

## Existing models and raw sources
- Workspace: `shared/schema.ts#L105` (`workspaces` table) with `plan` (`free|team`) and optional `storageBucket`; no usage or limits stored on the workspace record.
- LLM and pipeline runs: `skill_executions` and `skill_execution_steps` (`shared/schema.ts#L1477`) capture status/metadata only; tokens are currently passed around in responses but are not persisted as aggregated usage.
- Knowledge base ask/AI runs: `knowledge_base_ask_ai_runs` (`shared/schema.ts#L1140`) already store per-run `embeddingTokens`, `llmTokens`, `totalTokens`, durations, provider/model info.
- Embedding/vectorization of documents: `knowledge_document_chunk_sets` (`shared/schema.ts#L300`) keep per-version `totalTokens`, `chunkCount`, `totalChars`; `knowledge_base_rag_requests` (`shared/schema.ts#L674`) log search config per request. These are usable as raw signals for embedding cost.
- ASR: `asr_executions` (`shared/schema.ts#L1596`) contain `durationMs`, `fileSizeBytes`, provider/mode/status; this is the source for audio-minute usage.
- Storage objects: per-workspace bucket is referenced by `workspaces.storageBucket`; object keys are stored in features like transcripts (`transcripts.sourceFileId`) and uploads (see `server/yandex-object-storage-service.ts`), but there is no aggregated storage counter in DB.
- Entity counts: `skills`, `knowledge_bases`, `workspace_members` (and related `knowledge_nodes`/documents) are the current truth for object-based limits; no summary counters exist.
- No existing usage/limit aggregates were found; all signals are in raw logs/tables above.

## Single source of truth for usage
- Introduce a dedicated aggregate per workspace and billing period (proposed table name: `workspace_usage_month`). It will own counters for all resource types and be the only place to read/write current-period usage.
- Raw tables remain append-only signals; background jobs will fold them into the aggregate.
- Avoid scattering counters across feature tables; everything should reconcile into the aggregate keyed by `workspace_id + period`.

## Billing period model
- MVP: calendar month shared by all workspaces.
- Store `period_year`, `period_month` and derived `period_code` (`YYYY-MM`) on the usage aggregate. Alternative is a `billing_periods` table with date ranges and codes; the inline fields are simpler to index and validate uniqueness for now.
- Uniqueness requirement: one active record per `workspace_id + period_code`; no overlapping ranges within the same workspace.

## Usage metrics to track (MVP)
- `llm_tokens_total` (optionally split later into input/output)
- `embeddings_tokens_total`
- `asr_minutes_total`
- `storage_bytes_total`
- `skills_count`
- `knowledge_bases_count`
- `members_count`
- Extension slot: generic `{ metric_type, value }` to add future counters (actions, collections, documents) without schema churn.

## Validation notes (for future tests)
- Enforce uniqueness of `workspace_id + period_code` in the aggregate table.
- Reject overlapping period ranges for the same workspace.
- Reconcile that every aggregate row is derivable from raw signals (skill executions, KB runs, ASR executions, chunk sets, storage listing) for the same period.

## Implemented DB shape (step 2)
- Table `workspace_usage_month` (migration `0065_workspace_usage_month.sql`) is the single aggregate per `workspace_id + period_code`.
- Columns: identifiers (`id`, `workspace_id`), period (`period_year`, `period_month`, `period_code`), counters (llm_tokens_total, embeddings_tokens_total, asr_minutes_total, storage_bytes_total, skills_count, knowledge_bases_count, members_count), extensibility slot `extra_metrics jsonb`, state (`is_closed`, `closed_at`), timestamps.
- Constraints: unique index on `(workspace_id, period_code)`; CHECKS for month 1–12, non-negative counters, `period_code` format `YYYY-MM`.
- Period model is inlined on the aggregate; no separate `billing_periods` table yet.
- Ledger for LLM breakdown: `workspace_llm_usage_ledger` (migration `0066_workspace_llm_usage_ledger.sql`) captures per-execution tokens with workspace, provider, model, period, occurred_at; unique on `(workspace_id, execution_id)` plus period/model indexes for analytics.
- Ledger for embedding breakdown: `workspace_embedding_usage_ledger` (migration `0067_workspace_embedding_usage_ledger.sql`) captures per operation tokens/content with workspace, provider, model, period, occurred_at; unique on `(workspace_id, operation_id)` plus period/model indexes.

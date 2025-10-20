
-- PostgreSQL Database Schema for Tilda Search Bot
-- This script creates the complete database structure for local development

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS ltree;

-- Create users table for platform authentication
CREATE TABLE "users" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text NOT NULL UNIQUE,
    "full_name" text NOT NULL,
    "password_hash" text NOT NULL,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "personal_api_tokens" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token_hash" text NOT NULL,
    "last_four" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" timestamp
);

-- Рабочие пространства и члены рабочих пространств
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_plan') THEN
        CREATE TYPE "workspace_plan" AS ENUM ('free', 'team');
    END IF;
END $$;

CREATE TABLE "workspaces" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "owner_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "plan" workspace_plan NOT NULL DEFAULT 'free',
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_member_role') THEN
        CREATE TYPE "workspace_member_role" AS ENUM ('owner', 'manager', 'user');
    END IF;
END $$;

CREATE TABLE "workspace_members" (
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "role" workspace_member_role NOT NULL DEFAULT 'user',
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY ("workspace_id", "user_id")
);

CREATE TABLE "workspace_vector_collections" (
    "collection_name" text PRIMARY KEY,
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create sites table for storing crawl configurations
CREATE TABLE "sites" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text DEFAULT 'Новый проект' NOT NULL,
    "url" text NOT NULL UNIQUE,
    "start_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "crawl_depth" integer DEFAULT 3 NOT NULL,
    "max_chunk_size" integer DEFAULT 1200 NOT NULL,
    "chunk_overlap" boolean DEFAULT false NOT NULL,
    "chunk_overlap_size" integer DEFAULT 0 NOT NULL,
    "follow_external_links" boolean DEFAULT false NOT NULL,
    "crawl_frequency" text DEFAULT 'manual' NOT NULL,
    "exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "status" text DEFAULT 'idle' NOT NULL,
    "last_crawled" timestamp,
    "next_crawl" timestamp,
    "error" text,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "owner_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE
);

-- Create pages table for storing crawled page content
CREATE TABLE "pages" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "site_id" varchar NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
    "url" text NOT NULL UNIQUE,
    "title" text,
    "content" text,
    "meta_description" text,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "status_code" integer,
    "last_crawled" timestamp NOT NULL,
    "content_hash" text,
    "search_vector_title" tsvector,
    "search_vector_content" tsvector,
    "search_vector_combined" tsvector,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create search_index table for optimized text search
CREATE TABLE "search_index" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "page_id" varchar NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
    "term" text NOT NULL,
    "frequency" integer DEFAULT 1 NOT NULL,
    "position" integer NOT NULL,
    "relevance" double precision,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create embedding_providers table for external embedding services configuration
CREATE TABLE "embedding_providers" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "provider_type" text DEFAULT 'gigachat' NOT NULL,
    "description" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "token_url" text NOT NULL,
    "embeddings_url" text NOT NULL,
    "authorization_key" text DEFAULT '' NOT NULL,
    "scope" text NOT NULL,
    "model" text NOT NULL,
    "allow_self_signed_certificate" boolean DEFAULT false NOT NULL,
    "request_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "request_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "response_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "qdrant_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for performance
CREATE INDEX idx_sites_url ON sites(url);
CREATE INDEX idx_sites_status ON sites(status);
CREATE INDEX idx_sites_created_at ON sites(created_at);

CREATE INDEX idx_pages_site_id ON pages(site_id);
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_pages_last_crawled ON pages(last_crawled);
CREATE INDEX idx_pages_content_hash ON pages(content_hash);

-- Full-text search indexes
CREATE INDEX idx_pages_search_vector_title ON pages USING gin(search_vector_title);
CREATE INDEX idx_pages_search_vector_content ON pages USING gin(search_vector_content);
CREATE INDEX idx_pages_search_vector_combined ON pages USING gin(search_vector_combined);

-- pg_trgm indexes for similarity search (typo tolerance)
CREATE INDEX idx_pages_title_trgm ON pages USING gin(title gin_trgm_ops);
CREATE INDEX idx_pages_content_trgm ON pages USING gin(content gin_trgm_ops);

CREATE INDEX idx_search_index_page_id ON search_index(page_id);
CREATE INDEX idx_search_index_term ON search_index(term);
CREATE INDEX idx_search_index_relevance ON search_index(relevance);

CREATE INDEX idx_embedding_providers_active ON embedding_providers(is_active);
CREATE INDEX idx_embedding_providers_provider_type ON embedding_providers(provider_type);

CREATE INDEX personal_api_tokens_user_id_idx ON personal_api_tokens(user_id);
CREATE INDEX personal_api_tokens_active_idx ON personal_api_tokens(user_id) WHERE revoked_at IS NULL;

CREATE INDEX workspaces_owner_idx ON workspaces(owner_id);
CREATE INDEX workspace_members_workspace_idx ON workspace_members(workspace_id);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);

-- Базы знаний
CREATE TABLE "knowledge_bases" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name" text NOT NULL DEFAULT 'База знаний',
    "description" text NOT NULL DEFAULT '',
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_node_type') THEN
        CREATE TYPE "knowledge_node_type" AS ENUM ('folder', 'document');
    END IF;
END $$;

CREATE TABLE "knowledge_nodes" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "parent_id" varchar REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
    "title" text NOT NULL DEFAULT 'Без названия',
    "type" knowledge_node_type NOT NULL DEFAULT 'document',
    "content" text,
    "slug" text NOT NULL DEFAULT '',
    "path" ltree NOT NULL,
    "source_type" text NOT NULL DEFAULT 'manual',
    "import_file_name" text,
    "position" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_documents" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "node_id" varchar NOT NULL UNIQUE REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
    "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
    "current_version_id" varchar,
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "knowledge_document_versions" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "document_id" varchar NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "version_no" integer NOT NULL,
    "author_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
    "content_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "content_text" text NOT NULL DEFAULT '',
    "hash" text,
    "word_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX knowledge_bases_workspace_idx ON knowledge_bases(workspace_id);
CREATE UNIQUE INDEX knowledge_nodes_base_slug_idx ON knowledge_nodes(base_id, slug);
CREATE INDEX knowledge_nodes_base_parent_idx ON knowledge_nodes(base_id, parent_id);
CREATE INDEX knowledge_nodes_parent_idx ON knowledge_nodes(parent_id);
CREATE INDEX knowledge_nodes_workspace_idx ON knowledge_nodes(workspace_id);
CREATE INDEX knowledge_nodes_workspace_parent_idx ON knowledge_nodes(workspace_id, parent_id);
CREATE INDEX knowledge_nodes_base_parent_position_idx ON knowledge_nodes(base_id, parent_id, position);
CREATE INDEX knowledge_nodes_path_gin ON knowledge_nodes USING gin(path);
CREATE INDEX knowledge_documents_workspace_idx ON knowledge_documents(workspace_id);
CREATE INDEX knowledge_documents_base_idx ON knowledge_documents(base_id);
CREATE UNIQUE INDEX knowledge_document_versions_document_version_idx ON knowledge_document_versions(document_id, version_no);
CREATE INDEX knowledge_document_versions_document_created_idx ON knowledge_document_versions(document_id, created_at DESC);
CREATE INDEX knowledge_document_versions_workspace_idx ON knowledge_document_versions(workspace_id);

-- Triggers for automatic search vector updates
CREATE OR REPLACE FUNCTION update_search_vectors() RETURNS TRIGGER AS $$
BEGIN
    -- Update title search vector (weight A - highest priority)
    NEW.search_vector_title := setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A');
    
    -- Update content search vector (weight B for meta_description, C for content)
    NEW.search_vector_content := 
        setweight(to_tsvector('english', COALESCE(NEW.meta_description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C');
    
    -- Update combined search vector
    NEW.search_vector_combined := NEW.search_vector_title || NEW.search_vector_content;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic search vector updates
CREATE TRIGGER trigger_update_search_vectors
    BEFORE INSERT OR UPDATE OF title, content, meta_description
    ON pages
    FOR EACH ROW
    EXECUTE FUNCTION update_search_vectors();

-- Trigger for updating updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER trigger_sites_updated_at
    BEFORE UPDATE ON sites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_workspace_members_updated_at
    BEFORE UPDATE ON workspace_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_workspace_vector_collections_updated_at
    BEFORE UPDATE ON workspace_vector_collections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_knowledge_bases_updated_at
    BEFORE UPDATE ON knowledge_bases
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_knowledge_nodes_updated_at
    BEFORE UPDATE ON knowledge_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Insert sample data (optional)
INSERT INTO sites (url, crawl_depth, follow_external_links, crawl_frequency, exclude_patterns, status) VALUES
('https://example.com', 3, false, 'daily', '[]'::jsonb, 'idle'),
('https://docs.example.com', 5, false, 'weekly', '["*.pdf", "*.zip"]'::jsonb, 'idle');

-- Set search configuration for better Russian language support
-- You can adjust this based on your language requirements
SET default_text_search_config = 'english';

-- Comments for documentation
COMMENT ON TABLE sites IS 'Stores website crawl configurations and status';
COMMENT ON TABLE pages IS 'Stores crawled page content with full-text search vectors';
COMMENT ON TABLE search_index IS 'Optimized search index for fast text search';
COMMENT ON TABLE users IS 'User accounts for платформенный слой и аутентификацию';

COMMENT ON COLUMN sites.status IS 'Crawl status: idle, crawling, completed, failed';
COMMENT ON COLUMN sites.crawl_frequency IS 'Crawl frequency: manual, hourly, daily, weekly';
COMMENT ON COLUMN pages.search_vector_title IS 'Full-text search vector for page title (weight A)';
COMMENT ON COLUMN pages.search_vector_content IS 'Full-text search vector for page content (weight B/C)';
COMMENT ON COLUMN pages.search_vector_combined IS 'Combined search vector with all weights';

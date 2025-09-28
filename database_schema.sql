
-- PostgreSQL Database Schema for Tilda Search Bot
-- This script creates the complete database structure for local development

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

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

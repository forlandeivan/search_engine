#!/usr/bin/env tsx
/**
 * One-time production database fix for search functionality
 * Fixes tsvector column types and adds missing relevance column
 * Run once, then delete this script
 */

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

console.log('🔧 Starting production database fix...');
console.log('📍 Database URL:', DATABASE_URL.replace(/:[^:]*@/, ':***@'));

const sql = neon(DATABASE_URL);
const db = drizzle(sql);

async function fixProductionDatabase() {
  try {
    console.log('1️⃣ Creating required PostgreSQL extensions...');
    
    // Create required extensions for UUID generation and trigram similarity
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
    console.log('✅ pgcrypto extension ready');
    
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
    console.log('✅ pg_trgm extension ready');

    console.log('2️⃣ Checking current column types in pages table...');
    
    // Check if search_vector columns exist and their types
    const searchColumns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'pages' 
      AND column_name LIKE 'search_vector_%'
      ORDER BY column_name;
    `;
    
    console.log('Current search vector columns:', searchColumns);

    console.log('3️⃣ Fixing search_vector columns in pages table...');
    
    // Handle search_vector_title
    const titleExists = searchColumns.find(c => c.column_name === 'search_vector_title');
    if (!titleExists) {
      await sql`ALTER TABLE pages ADD COLUMN search_vector_title tsvector;`;
      console.log('✅ Added search_vector_title column');
    } else if (titleExists.data_type !== 'tsvector') {
      await sql`ALTER TABLE pages ADD COLUMN search_vector_title_new tsvector;`;
      await sql`UPDATE pages SET search_vector_title_new = to_tsvector('english', COALESCE(title, '')) WHERE title IS NOT NULL;`;
      await sql`ALTER TABLE pages DROP COLUMN search_vector_title;`;
      await sql`ALTER TABLE pages RENAME COLUMN search_vector_title_new TO search_vector_title;`;
      console.log('✅ Fixed search_vector_title column type');
    }

    // Handle search_vector_content  
    const contentExists = searchColumns.find(c => c.column_name === 'search_vector_content');
    if (!contentExists) {
      await sql`ALTER TABLE pages ADD COLUMN search_vector_content tsvector;`;
      console.log('✅ Added search_vector_content column');
    } else if (contentExists.data_type !== 'tsvector') {
      await sql`ALTER TABLE pages ADD COLUMN search_vector_content_new tsvector;`;
      await sql`UPDATE pages SET search_vector_content_new = to_tsvector('english', COALESCE(content, '')) WHERE content IS NOT NULL;`;
      await sql`ALTER TABLE pages DROP COLUMN search_vector_content;`;
      await sql`ALTER TABLE pages RENAME COLUMN search_vector_content_new TO search_vector_content;`;
      console.log('✅ Fixed search_vector_content column type');
    }

    // Handle search_vector_combined
    const combinedExists = searchColumns.find(c => c.column_name === 'search_vector_combined');
    if (!combinedExists) {
      await sql`ALTER TABLE pages ADD COLUMN search_vector_combined tsvector;`;
      console.log('✅ Added search_vector_combined column');
    } else if (combinedExists.data_type !== 'tsvector') {
      await sql`ALTER TABLE pages ADD COLUMN search_vector_combined_new tsvector;`;
      await sql`UPDATE pages SET search_vector_combined_new = 
        setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(content, '')), 'B')
        WHERE title IS NOT NULL OR content IS NOT NULL;`;
      await sql`ALTER TABLE pages DROP COLUMN search_vector_combined;`;
      await sql`ALTER TABLE pages RENAME COLUMN search_vector_combined_new TO search_vector_combined;`;
      console.log('✅ Fixed search_vector_combined column type');
    }

    console.log('4️⃣ Checking relevance column in search_index table...');
    
    // Check if relevance column exists in search_index
    const relevanceExists = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'search_index' 
      AND column_name = 'relevance';
    `;
    
    if (relevanceExists.length === 0) {
      await sql`ALTER TABLE search_index ADD COLUMN relevance double precision;`;
      console.log('✅ Added relevance column to search_index');
    } else {
      console.log('✅ Relevance column already exists');
    }

    console.log('5️⃣ Rebuilding search vectors for existing data...');
    
    // Update all search vectors for existing pages
    await sql`
      UPDATE pages 
      SET 
        search_vector_title = to_tsvector('english', COALESCE(title, '')),
        search_vector_content = to_tsvector('english', COALESCE(content, '')),
        search_vector_combined = 
          setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
          setweight(to_tsvector('english', COALESCE(content, '')), 'B')
      WHERE title IS NOT NULL OR content IS NOT NULL;
    `;
    
    const updatedRows = await sql`SELECT COUNT(*) as count FROM pages WHERE search_vector_combined IS NOT NULL;`;
    console.log(`✅ Updated search vectors for ${updatedRows[0].count} pages`);

    console.log('6️⃣ Creating search index for better performance...');
    
    // Create GIN index on combined search vector if it doesn't exist
    try {
      await sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pages_search_vector_combined ON pages USING gin(search_vector_combined);`;
      console.log('✅ Created GIN index on search_vector_combined');
    } catch (error) {
      // Index might already exist or concurrent creation failed
      console.log('ℹ️  Search index creation skipped (might already exist)');
    }

    console.log('🎉 Production database fix completed successfully!');
    console.log('📊 Final verification...');
    
    // Verify the fix worked
    const verification = await sql`
      SELECT 
        COUNT(*) as total_pages,
        COUNT(search_vector_combined) as pages_with_search_vectors,
        (SELECT COUNT(*) FROM search_index WHERE relevance IS NOT NULL) as search_index_with_relevance
      FROM pages;
    `;
    
    console.log('Verification results:', verification[0]);
    
    if (verification[0].total_pages > 0 && verification[0].pages_with_search_vectors > 0) {
      console.log('✅ Database fix verification passed!');
    } else {
      console.log('⚠️  Warning: No data found to verify fix');
    }

  } catch (error) {
    console.error('❌ Error fixing production database:', error);
    throw error;
  }
}

// Run the fix
fixProductionDatabase()
  .then(() => {
    console.log('🏁 Script completed. Please test production search API and then delete this script.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
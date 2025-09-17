import pkg from 'pg';
const { Client } = pkg;

// Production DATABASE_URL
const PRODUCTION_DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:neon_password@ep-purple-firefly-ae4mkzyo.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function debugProductionHealth() {
  const client = new Client({
    connectionString: PRODUCTION_DB_URL,
  });

  try {
    console.log('🔌 Connecting to production database...');
    await client.connect();
    console.log('✅ Connected successfully');

    // Perform exact same checks as health endpoint
    console.log('\n📋 Getting schema info...');
    const schemaResult = await client.query(`
      SELECT 
        current_schema() as schema_name,
        current_database() as database_name
    `);
    console.log('Schema info:', schemaResult.rows[0]);

    console.log('\n🔍 Checking extensions...');
    const extensionsResult = await client.query(`
      SELECT 
        extname,
        extversion
      FROM pg_extension 
      WHERE extname IN ('pg_trgm', 'unaccent', 'pgcrypto')
    `);
    
    console.log('Extensions found:', extensionsResult.rows);
    
    const extensions = extensionsResult.rows;
    const pg_trgm_available = extensions.some(ext => ext.extname === 'pg_trgm');
    const unaccent_available = extensions.some(ext => ext.extname === 'unaccent');
    
    console.log('pg_trgm_available:', pg_trgm_available);
    console.log('unaccent_available:', unaccent_available);

    console.log('\n📊 Checking search vector columns...');
    const columnsResult = await client.query(`
      SELECT 
        column_name,
        data_type
      FROM information_schema.columns 
      WHERE table_name = 'pages' 
      AND column_name LIKE 'search_vector_%'
    `);
    
    console.log('Search vector columns:', columnsResult.rows);

    console.log('\n📈 Checking relevance column...');
    const relevanceResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'search_index' 
      AND column_name = 'relevance'
    `);
    
    console.log('Relevance column:', relevanceResult.rows);

    // Test a simple search query to see what fails
    console.log('\n🔍 Testing FTS query...');
    try {
      const testResult = await client.query(`
        SELECT COUNT(*) as count
        FROM pages 
        WHERE search_vector_combined @@ to_tsquery('simple', 'test')
        LIMIT 1
      `);
      console.log('✅ FTS query successful:', testResult.rows[0]);
    } catch (ftsError) {
      console.error('❌ FTS query failed:', ftsError.message);
    }

    // Test similarity query
    console.log('\n🔍 Testing similarity query...');
    try {
      const simResult = await client.query(`
        SELECT COUNT(*) as count
        FROM pages 
        WHERE similarity(COALESCE(title, ''), 'test') > 0.2
        LIMIT 1
      `);
      console.log('✅ Similarity query successful:', simResult.rows[0]);
    } catch (simError) {
      console.error('❌ Similarity query failed:', simError.message);
    }

  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error('Full error:', error);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

debugProductionHealth().catch(console.error);
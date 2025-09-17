import pkg from 'pg';
const { Client } = pkg;

// Production DATABASE_URL
const PRODUCTION_DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:neon_password@ep-purple-firefly-ae4mkzyo.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function fixProductionExtensions() {
  const client = new Client({
    connectionString: PRODUCTION_DB_URL,
  });

  try {
    console.log('🔌 Connecting to production database...');
    await client.connect();
    console.log('✅ Connected successfully');

    // Check current extensions
    console.log('\n📋 Checking current extensions...');
    const extensionsResult = await client.query(`
      SELECT extname 
      FROM pg_extension 
      WHERE extname IN ('pg_trgm', 'unaccent')
      ORDER BY extname;
    `);
    
    const currentExtensions = extensionsResult.rows.map(row => row.extname);
    console.log('Current extensions:', currentExtensions);

    // Install missing extensions
    const requiredExtensions = ['pg_trgm', 'unaccent'];
    
    for (const ext of requiredExtensions) {
      if (!currentExtensions.includes(ext)) {
        console.log(`\n🔧 Installing extension: ${ext}`);
        try {
          await client.query(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
          console.log(`✅ Extension ${ext} installed successfully`);
        } catch (error) {
          console.error(`❌ Failed to install ${ext}:`, error.message);
        }
      } else {
        console.log(`✅ Extension ${ext} already exists`);
      }
    }

    // Verify all extensions are now available
    console.log('\n🔍 Verifying extensions after installation...');
    const finalCheck = await client.query(`
      SELECT extname 
      FROM pg_extension 
      WHERE extname IN ('pg_trgm', 'unaccent')
      ORDER BY extname;
    `);
    
    const finalExtensions = finalCheck.rows.map(row => row.extname);
    console.log('Final extensions:', finalExtensions);

    if (finalExtensions.includes('pg_trgm') && finalExtensions.includes('unaccent')) {
      console.log('\n🎉 SUCCESS: All required PostgreSQL extensions are now available!');
    } else {
      console.log('\n❌ ERROR: Some extensions are still missing');
    }

  } catch (error) {
    console.error('❌ Database operation failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

fixProductionExtensions().catch(console.error);
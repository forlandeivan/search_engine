
import pkg from 'pg';
const { Client } = pkg;

// Production DATABASE_URL
const PRODUCTION_DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:neon_password@ep-purple-firefly-ae4mkzyo.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function checkExtensions() {
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

    // Try to install missing extensions
    const requiredExtensions = ['pg_trgm', 'unaccent'];
    
    for (const ext of requiredExtensions) {
      if (!currentExtensions.includes(ext)) {
        console.log(`\n🔧 Trying to install extension: ${ext}`);
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

    // Final verification
    console.log('\n🔍 Final verification...');
    const finalCheck = await client.query(`
      SELECT extname 
      FROM pg_extension 
      WHERE extname IN ('pg_trgm', 'unaccent')
      ORDER BY extname;
    `);
    
    const finalExtensions = finalCheck.rows.map(row => row.extname);
    console.log('Final extensions:', finalExtensions);

    if (finalExtensions.includes('pg_trgm') && finalExtensions.includes('unaccent')) {
      console.log('\n🎉 SUCCESS: All required extensions are available!');
    } else {
      console.log('\n❌ PROBLEM: Some extensions are still missing');
      console.log('Missing extensions:', requiredExtensions.filter(ext => !finalExtensions.includes(ext)));
    }

  } catch (error) {
    console.error('❌ Operation failed:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

checkExtensions().catch(console.error);

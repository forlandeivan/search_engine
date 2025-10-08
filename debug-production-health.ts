import pkg from 'pg';
import type { Client as PgClient } from 'pg';
const { Client } = pkg;

// Production DATABASE_URL
const PRODUCTION_DB_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:neon_password@ep-purple-firefly-ae4mkzyo.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

type WorkspaceQueryOptions = {
  workspaceName?: string;
  ownerEmail?: string;
};

async function logWorkspaceState(client: PgClient, { workspaceName, ownerEmail }: WorkspaceQueryOptions) {
  if (!workspaceName && !ownerEmail) {
    console.log('\nℹ️  Workspace name or owner email not provided, skipping workspace state check');
    return;
  }

  console.log(`\n📦 Checking workspace state for name="${workspaceName ?? '—'}" owner="${ownerEmail ?? '—'}"`);

  const conditions: string[] = [];
  const values: string[] = [];

  if (workspaceName) {
    conditions.push(`w.name = $${conditions.length + 1}`);
    values.push(workspaceName);
  }

  if (ownerEmail) {
    conditions.push(`u.email = $${conditions.length + 1}`);
    values.push(ownerEmail);
  }

  const whereClause = conditions.length > 0 ? conditions.join(' OR ') : '1=0';

  const workspaceResult = await client.query<{ id: string; name: string; owner_id: string; owner_email: string | null }>(
    `
      SELECT w.id, w.name, w.owner_id, u.email as owner_email
      FROM workspaces w
      LEFT JOIN users u ON u.id = w.owner_id
      WHERE ${whereClause}
      ORDER BY w.created_at
    `,
    values,
  );

  if (workspaceResult.rows.length === 0) {
    console.log('⚠️  Workspace not found');
    return;
  }

  for (const workspace of workspaceResult.rows) {
    console.log(`\n➡️  Workspace ${workspace.name} (${workspace.id}) owner=${workspace.owner_email ?? 'unknown'}`);

    const sitesCountResult = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM sites WHERE workspace_id = $1',
      [workspace.id],
    );
    const siteCount = Number.parseInt(sitesCountResult.rows[0]?.count ?? '0', 10);
    console.log(`   • Projects: ${Number.isFinite(siteCount) ? siteCount : 'unknown'}`);

    const pagesCountResult = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM pages p
        JOIN sites s ON s.id = p.site_id
        WHERE s.workspace_id = $1
      `,
      [workspace.id],
    );
    const pageCount = Number.parseInt(pagesCountResult.rows[0]?.count ?? '0', 10);
    console.log(`   • Indexed pages: ${Number.isFinite(pageCount) ? pageCount : 'unknown'}`);

    const siteDetailsResult = await client.query<{
      id: string;
      name: string;
      url: string;
      status: string;
      last_crawled: string | null;
      page_count: string;
    }>(
      `
        SELECT s.id, s.name, s.url, s.status, s.last_crawled, COUNT(p.id)::text AS page_count
        FROM sites s
        LEFT JOIN pages p ON p.site_id = s.id
        WHERE s.workspace_id = $1
        GROUP BY s.id
        ORDER BY s.created_at
      `,
      [workspace.id],
    );

    if (siteDetailsResult.rows.length === 0) {
      console.log('   • No projects linked to this workspace');
    } else {
      for (const site of siteDetailsResult.rows) {
        const pagesTotal = Number.parseInt(site.page_count ?? '0', 10);
        console.log(
          `   • Project ${site.name} (${site.id}) url=${site.url} status=${site.status} pages=${Number.isFinite(pagesTotal) ? pagesTotal : 'unknown'} lastCrawled=${site.last_crawled ?? 'never'}`,
        );
      }
    }
  }
}

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
    try {
      await logWorkspaceState(client, { workspaceName: 'forlandeivan', ownerEmail: 'forlandeivan@gmail.com' });
    } catch (workspaceError) {
      console.error('❌ Workspace state check failed:', workspaceError instanceof Error ? workspaceError.message : workspaceError);
    }

    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

debugProductionHealth().catch(console.error);
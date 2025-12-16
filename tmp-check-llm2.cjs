const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  const wsId = 'ef963a28-2da1-45a8-8cce-6f67b66a04a5';
  const providers = await c.query("select id, name, provider_type, model, is_active from llm_providers where workspace_id=$1", [wsId]);
  console.log('llm_providers', providers.rows);
  const skills = await c.query("select id, name, llm_provider_config_id from skills where workspace_id=$1", [wsId]);
  console.log('skills', skills.rows);
  await c.end();
})();

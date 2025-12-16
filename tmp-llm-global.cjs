const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  const globals = await c.query("select id,name,provider_type,model,is_active from llm_providers where is_global=true");
  console.log(globals.rows);
  await c.end();
})();

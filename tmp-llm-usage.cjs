const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
const wsId = 'ef963a28-2da1-45a8-8cce-6f67b66a04a5';
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  const ledger = await c.query("select sum(tokens_total)::bigint as total, count(*) as cnt from workspace_llm_usage_ledger where workspace_id=$1", [wsId]);
  console.log('ledger', ledger.rows);
  const month = await c.query("select period_code, llm_tokens_total from workspace_usage_month where workspace_id=$1 order by period_code desc", [wsId]);
  console.log('month', month.rows);
  await c.end();
})();

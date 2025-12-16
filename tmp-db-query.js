const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
const q = `select id, name from workspaces where name like 'workspace-ctx-%' or name like 'ctx-ws-%' or name like 'ctx-foreign-%' or name like 'workspace-ctx-other-%' or name like 'chat-legacy-%' or name like 'ws-llm-usage-ledger-%';`;
(async ()=> {
  const c = new Client({ connectionString: conn });
  await c.connect();
  const r = await c.query(q);
  console.log(r.rows);
  await c.end();
})();

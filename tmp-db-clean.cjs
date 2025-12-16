const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
const queries = [
  `delete from workspace_members where workspace_id in (
      select id from workspaces
      where name like 'workspace-ctx-%'
         or name like 'ctx-ws-%'
         or name like 'ctx-foreign-%'
         or name like 'workspace-ctx-other-%'
         or name like 'chat-legacy-%'
         or name like 'ws-llm-usage-ledger-%'
    );`,
  `delete from workspaces
    where name like 'workspace-ctx-%'
       or name like 'ctx-ws-%'
       or name like 'ctx-foreign-%'
       or name like 'workspace-ctx-other-%'
       or name like 'chat-legacy-%'
       or name like 'ws-llm-usage-ledger-%';`,
  `delete from workspace_members where user_id in (
      select id from users
      where email like '%workspace-ctx-%@example.com'
         or email like '%chat-legacy-%@example.com'
         or email like '%llm-ledger-%@example.com'
         or email like '%llm-ledger-agg-%@example.com'
         or email like '%asr-ledger-%@example.com'
         or email like '%embedding-ledger-%@example.com'
         or email like '%embedding-ledger-agg-%@example.com'
         or email like '%membership-other-%@example.com'
         or email like '%workspace-me-owner-%@example.com'
         or email like '%workspace-me-manager-%@example.com'
    );`,
  `delete from users
    where email like '%workspace-ctx-%@example.com'
       or email like '%chat-legacy-%@example.com'
       or email like '%llm-ledger-%@example.com'
       or email like '%llm-ledger-agg-%@example.com'
       or email like '%asr-ledger-%@example.com'
       or email like '%embedding-ledger-%@example.com'
       or email like '%embedding-ledger-agg-%@example.com'
       or email like '%membership-other-%@example.com'
       or email like '%workspace-me-owner-%@example.com'
       or email like '%workspace-me-manager-%@example.com';`
];
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  for (const q of queries) {
    const res = await c.query(q);
    console.log(`${q.split('\n')[0]} => ${res.rowCount}`);
  }
  await c.end();
})();

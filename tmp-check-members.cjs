const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  const res = await c.query("select workspace_id, user_id, role from workspace_members where user_id='58494fbc-a46f-448d-ad12-3a1df0bbcf56'");
  console.log(res.rows);
  await c.end();
})();

const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  const userRes = await c.query("select id,email from users where email='frol_14@mail.ru'");
  console.log('user', userRes.rows);
  const wsRes = await c.query("select id,name, owner_id, tariff_plan_id from workspaces where id='ef963a28-2da1-45a8-8cce-6f67b66a04a5'");
  console.log('workspace', wsRes.rows);
  const memRes = await c.query("select user_id, role, status from workspace_members where workspace_id='ef963a28-2da1-45a8-8cce-6f67b66a04a5'");
  console.log('members', memRes.rows);
  await c.end();
})();

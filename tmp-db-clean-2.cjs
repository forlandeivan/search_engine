const { Client } = require('pg');
const conn = 'postgresql://search_engine_local_user:4uP%404ups@localhost:5432/search_engine_local';
const targets = [
  'workspace-me-stranger-%',
  'membership-ws-%',
  'membership-%',
  'login-test-confirmed',
  'verify-test'
];
const userEmails = [
  '%workspace-me-stranger-%@example.com%',
  '%membership-%@example.com%',
  '%login-test-confirmed@example.com%',
  '%verify-test@example.com%'
];
const wsWhere = targets.map(t => `name like '${t}'`).join(' or ');
const userWhere = userEmails.map(t => `email like '${t}'`).join(' or ');
const queries = [
  `delete from workspace_members where workspace_id in (select id from workspaces where ${wsWhere});`,
  `delete from workspaces where ${wsWhere};`,
  `delete from workspace_members where user_id in (select id from users where ${userWhere});`,
  `delete from users where ${userWhere};`
];
(async ()=>{
  const c = new Client({ connectionString: conn });
  await c.connect();
  for (const q of queries) {
    const res = await c.query(q);
    console.log(q.split('\n')[0], '=>', res.rowCount);
  }
  await c.end();
})();

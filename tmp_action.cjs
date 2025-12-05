require("dotenv").config();const {Client}=require("pg");const client=new Client({connectionString:process.env.DATABASE_URL});const actionId="3a631d11-a992-42e4-80e0-0b3aca6998f3";const skillId="cd29dbde-42ce-4813-a1f3-9be629cc784e";
(async()=>{
  await client.connect();
  const a=await client.query('select id,label,target,placements,output_mode,input_type from actions where id=$1',[actionId]);
  console.log('action',a.rows);
  const sa=await client.query('select skill_id,action_id,enabled,enabled_placements from skill_actions where skill_id=$1 and action_id=$2',[skillId,actionId]);
  console.log('skill_action',sa.rows);
  await client.end();
})();

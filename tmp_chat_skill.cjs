require("dotenv").config();
const {Client}=require("pg");
const chatId="1c7d4399-795b-4d65-9d13-d528b909ec63";
(async()=>{
  const client=new Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  const chat=await client.query('select id,workspace_id,skill_id from chat_sessions where id=$1',[chatId]);
  console.log('chat', chat.rows);
  if(chat.rows[0]){
    const skillId=chat.rows[0].skill_id;
    const skill=await client.query('select id,name,on_transcription_mode,on_transcription_auto_action_id from skills where id=$1',[skillId]);
    console.log('skill', skill.rows);
  }
  await client.end();
})();

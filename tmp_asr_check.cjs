require("dotenv").config();
const {Client}=require("pg");
const client=new Client({host:process.env.PG_HOST,user:process.env.PG_USER,password:process.env.PG_PASSWORD,database:process.env.PG_DATABASE,port:Number(process.env.PG_PORT||5432)});
(async()=>{
  await client.connect();
  const t=await client.query('select id,workspace_id,chat_id,status,full_text,preview_text,source_file_id,default_view_action_id from transcripts where id=$1',["902729e8-1720-4c4f-a5ad-f07f96e3afa4"]);
  console.log('transcript',t.rows);
  const m1=await client.query('select id,role,content,metadata from chat_messages where id=$1',["ad5b541d-dd2c-4905-9210-7a53126469c2"]);
  console.log('placeholder',m1.rows);
  const m2=await client.query('select id,role,content,metadata from chat_messages where id=$1',["2697f55e-093c-414b-825c-2805d4fbaf2f"]);
  console.log('audio',m2.rows);
  await client.end();
})();

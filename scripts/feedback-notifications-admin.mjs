import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
const root=process.cwd();
for(const line of fs.readFileSync(path.join(root,'.env.local'),'utf8').split(/\r?\n/)){
 const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const passwordPath=[path.join(root,'supabase で設定したパスワード.txt'),path.resolve(root,'../../supabase で設定したパスワード.txt')].find(p=>fs.existsSync(p));
const passwords=process.env.SUPABASE_DB_PASSWORD?[process.env.SUPABASE_DB_PASSWORD]:fs.readFileSync(passwordPath,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>=12&&s.length<=64&&!s.includes(':')).reverse();
let db;
for(const host of ['aws-1-ap-northeast-1.pooler.supabase.com','aws-0-ap-northeast-1.pooler.supabase.com',`db.${project}.supabase.co`]){
 for(const password of passwords){const c=new pg.Client({host,port:host.startsWith('db.')?5432:6543,user:host.startsWith('db.')?'postgres':`postgres.${project}`,password,database:'postgres',ssl:{rejectUnauthorized:false},connectionTimeoutMillis:6000,query_timeout:30000});
  try{await c.connect();db=c;break;}catch{await c.end().catch(()=>{});}
 }if(db)break;
}
if(!db)throw Error('Database connection unavailable');
const dir=path.join(root,'analysis_outputs/feedback-notifications');fs.mkdirSync(dir,{recursive:true});
const mode=process.argv[2]??'--inspect';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function recipient(){
 const rows=(await db.query(`select c.staff_id,c.recipient from interview_pilot_notification_config c
  join staff_accounts a on a.id=c.staff_id and a.staff_code='KUDO' and a.active
  join bentan_feedback_reader r on r.singleton and r.staff_id=a.id
  where c.id and exists(select 1 from student_line_accounts l where l.student_number=c.student_number
    and l.line_user_id=c.recipient and l.relation='student' and l.verification_status='confirmed')`)).rows;
 if(rows.length!==1||!/^U[0-9a-f]{32}$/.test(rows[0].recipient))throw Error('Confirmed KUDO recipient unavailable');
 return rows[0];
}
try{
 const owner=await recipient();
 if(mode==='--inspect'){
  const counts=(await db.query('select count(*)::int count from bentan_feedback')).rows[0];
  const extensions=(await db.query("select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault')")).rows;
  console.log(JSON.stringify({kudoReaderAndConfirmedLineMatch:true,existingFeedback:counts.count,extensions:extensions.map(x=>x.extname),lineTokenAvailable:!!process.env.LINE_CHANNEL_ACCESS_TOKEN}));
 }else if(mode==='--apply'){
  await db.query('begin');await db.query("set local lock_timeout='8s'");
  const rows=(await db.query("select to_jsonb(f)-'reviewed_at' row from bentan_feedback f order by id")).rows;
  const definitions=(await db.query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('list_bentan_feedback')")).rows;
  fs.writeFileSync(path.join(dir,`before_${Date.now()}.json`),JSON.stringify({rows,definitions,reader:(await db.query('select * from bentan_feedback_reader')).rows},null,2),{flag:'wx'});
  await db.query(fs.readFileSync(path.join(root,'supabase/feedback_notifications_20261016.sql'),'utf8'));
  const existing=(await db.query('select * from bentan_feedback_notification_config where singleton')).rows[0];
  if(existing&&(existing.staff_id!==owner.staff_id||existing.recipient!==owner.recipient))throw Error('Existing notification recipient conflict');
  await db.query('insert into bentan_feedback_notification_config(singleton,staff_id,recipient,enabled) values(true,$1,$2,true) on conflict(singleton) do update set enabled=true',[owner.staff_id,owner.recipient]);
  const after=(await db.query("select to_jsonb(f)-'reviewed_at' row from bentan_feedback f order by id")).rows;
  if(hash(rows)!==hash(after))throw Error('Existing feedback changed');
  for(const role of ['anon','authenticated']){
   const allowed=(await db.query(`select has_table_privilege('${role}','bentan_feedback_notifications','select') a,
    has_function_privilege('${role}','feedback_inbox_summary(uuid,uuid)','execute') b,
    has_function_privilege('${role}','review_bentan_feedback(uuid,uuid,uuid)','execute') c`)).rows[0];
   if(Object.values(allowed).some(Boolean))throw Error('Public feedback access detected');
  }
  await db.query('commit');
  console.log(JSON.stringify({applied:true,existingFeedbackUnchanged:true,kudoOnly:true,historicalNotificationsAdded:0}));
 }else if(mode==='--schedule'){
  const secrets=(await db.query("select name,decrypted_secret from vault.decrypted_secrets where name in ('attendance_app_url','attendance_internal_token')")).rows;
  const url=secrets.find(s=>s.name==='attendance_app_url')?.decrypted_secret;
  const token=secrets.find(s=>s.name==='attendance_internal_token')?.decrypted_secret;
  const expected=createHmac('sha256',process.env.SUPABASE_SECRET_KEY).update('attendance-analysis-cron-v1').digest('hex');
  if(url!=='https://line-check-system.vercel.app'||token!==expected)throw Error('Existing scheduler authentication mismatch');
  const command=`select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='attendance_app_url') || '/api/cron/feedback-notifications', headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='attendance_internal_token'),'Content-Type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 55000);`;
  await db.query('select cron.schedule($1,$2,$3)',['bentan-feedback-notifications','* * * * *',command]);
  console.log(JSON.stringify({scheduled:true,job:(await db.query("select jobname,schedule,active from cron.job where jobname='bentan-feedback-notifications'")).rows[0]}));
 }else if(mode==='--send-test'){
  const cfg=(await db.query('select * from bentan_feedback_notification_config where singleton and enabled')).rows[0];
  if(cfg?.staff_id!==owner.staff_id||cfg?.recipient!==owner.recipient)throw Error('Notification target mismatch');
  const text='【勉たん・通知の動作確認】\n改善要望が投稿された際に、このLINEへ新着をお知らせする設定を追加しました。\n投稿内容は工藤専用画面で確認できます。\nhttps://line-check-system.vercel.app/private-feedback';
  const key=randomUUID();
  const response=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,'Content-Type':'application/json','X-Line-Retry-Key':key},body:JSON.stringify({to:owner.recipient,messages:[{type:'text',text}]}),signal:AbortSignal.timeout(10000)});
  const requestId=response.headers.get('x-line-request-id');
  if(!response.ok)throw Error(`LINE test HTTP ${response.status}`);
  await db.query(`insert into line_messages(line_message_id,line_user_id,direction,message_type,text,sent_by,received_at,raw_event)
   values($1,$2,'outbound','text',$3,'改善要望の通知・動作確認',now(),$4)`,['feedback_test_'+key,owner.recipient,text,{send_context:'bentan_feedback_notification_test',retry_key:key,line_request_id:requestId}]);
  fs.writeFileSync(path.join(dir,'line-test.json'),JSON.stringify({sent:true,status:response.status,requestId,recipient:'confirmed KUDO',sentAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({testSent:true,status:response.status,kudoOnly:true}));
 }else if(mode==='--status'){
  const statuses=(await db.query('select status,count(*)::int count from bentan_feedback_notifications group by status')).rows;
  const job=(await db.query("select j.jobname,j.schedule,j.active,r.status last_status from cron.job j left join lateral(select status from cron.job_run_details where jobid=j.jobid order by start_time desc limit 1) r on true where j.jobname='bentan-feedback-notifications'")).rows;
  console.log(JSON.stringify({statuses,job}));
 }else throw Error('Unknown mode');
}catch(error){await db.query('rollback').catch(()=>{});console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
finally{await db.end();}

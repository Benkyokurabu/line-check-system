import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sendFeedbackNotifications} from '../src/lib/feedback-notifications.mjs';
const db=new PGlite(),owner=randomUUID(),other=randomUUID(),session=randomUUID(),recipient='U'+'a'.repeat(32);
const migration=await readFile(new URL('../supabase/feedback_notifications_20261016.sql',import.meta.url),'utf8');
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table staff_accounts(id uuid primary key,staff_code text,active boolean default true);
 create table line_messages(line_message_id text primary key,line_user_id text,direction text,message_type text,text text,sent_by text,received_at timestamptz,raw_event jsonb);
 create function staff_authorize(p_user uuid,p_session uuid) returns jsonb language plpgsql as $$begin
 if p_session<>'${session}'::uuid or not exists(select 1 from staff_accounts where id=p_user and active) then raise exception 'staff_session_invalid';end if;
 return jsonb_build_object('staffId',p_user);end;$$;`);
 await db.query("insert into staff_accounts(id,staff_code) values($1,'KUDO'),($2,'OTHER')",[owner,other]);
 for(const file of ['feedback_20260910.sql','feedback_sharing_20260911.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 await db.query('insert into bentan_feedback_reader(staff_id) values($1)',[owner]);
 await db.query("select submit_bentan_feedback($1,'以前の投稿','内容',$2)",[randomUUID(),'f'.repeat(64)]);
 await db.exec(migration);
 await db.query('insert into bentan_feedback_notification_config(staff_id,recipient,enabled) values($1,$2,true)',[owner,recipient]);
});
after(()=>db.close());
async function submit(){const id=randomUUID();await db.query("select submit_bentan_feedback($1,'投稿者','非公開の本文',$2,'anonymous')",[id,randomUUID().replaceAll('-','').repeat(2)]);return id;}
async function claim(id){return(await db.query('select feedback_notification_claim($1) n',[id])).rows[0].n;}
test('historical records remain intact and are not queued for LINE',async()=>{
 assert.equal((await db.query('select count(*)::int n from bentan_feedback_notifications')).rows[0].n,0);
 const summary=(await db.query('select feedback_inbox_summary($1,$2) n',[owner,session])).rows[0].n;
 assert.equal(summary.unreviewedCount,1);
});
test('a retried submission produces one notification and keeps the privacy preference',async()=>{
 const id=randomUUID(),key='d'.repeat(64);
 for(let i=0;i<2;i++)await db.query("select submit_bentan_feedback($1,'投稿者','本文',$2,'anonymous')",[id,key]);
 assert.equal((await db.query('select count(*)::int n from bentan_feedback_notifications where feedback_id=$1',[id])).rows[0].n,1);
 const rows=(await db.query('select get_bentan_feedback_inbox($1,$2,0,true) n',[owner,session])).rows[0].n.feedback;
 assert.equal(rows.find(r=>r.id===id).sharing_preference,'anonymous');assert.ok(rows.every(r=>r.rate_key===undefined));
});
test('only the KUDO reader can see counts, list, or mark reviewed; marking is idempotent',async()=>{
 const id=await submit();
 for(const sql of ['select feedback_inbox_summary($1,$2)','select get_bentan_feedback_inbox($1,$2)','select review_bentan_feedback($1,$2,$3)']){
  await assert.rejects(db.query(sql,sql.includes('$3')?[other,session,id]:[other,session]),/staff_permission_denied/);
 }
 await assert.rejects(db.query('select feedback_inbox_summary($1,$2)',[owner,randomUUID()]),/staff_session_invalid/);
 await db.query('select review_bentan_feedback($1,$2,$3)',[owner,session,id]);
 const first=(await db.query('select reviewed_at from bentan_feedback where id=$1',[id])).rows[0].reviewed_at;
 await db.query('select review_bentan_feedback($1,$2,$3)',[owner,session,id]);
 assert.equal(String((await db.query('select reviewed_at from bentan_feedback where id=$1',[id])).rows[0].reviewed_at),String(first));
 const unread=(await db.query('select get_bentan_feedback_inbox($1,$2,0,true) n',[owner,session])).rows[0].n.feedback;
 assert.ok(!unread.some(r=>r.id===id));
 assert.ok((await db.query('select list_bentan_feedback($1,$2) n',[owner,session])).rows[0].n.feedback.some(r=>r.id===id));
});
test('claim leases prevent duplicate workers and retries reuse the same LINE retry key',async()=>{
 const id=await submit(),one=await claim(id);assert.equal(one.recipient,recipient);
 assert.ok(!one.message.includes('投稿者')&&!one.message.includes('非公開の本文'));
 assert.equal(await claim(id),null);
 assert.equal((await db.query("select feedback_notification_finish($1,$2,'sent',null,null) n",[id,randomUUID()])).rows[0].n,false);
 await db.query("select feedback_notification_finish($1,$2,'retry',null,'timeout')",[id,one.lease]);
 assert.equal(await claim(id),null);
 await db.query("update bentan_feedback_notifications set next_attempt_at=now()-interval '1 second' where feedback_id=$1",[id]);
 const two=await claim(id);assert.equal(two.retry_key,one.retry_key);assert.notEqual(two.lease,one.lease);
 await db.query("select feedback_notification_finish($1,$2,'sent','accepted',null)",[id,two.lease]);
 assert.equal(await claim(id),null);
 assert.equal((await db.query("select count(*)::int n from line_messages where line_message_id=$1",['feedback_notification_'+one.retry_key])).rows[0].n,1);
});
test('disabled recipients, recipient changes and retry expiry never send to a different person',async()=>{
 const id=await submit();await db.query('update bentan_feedback_notification_config set enabled=false');assert.equal(await claim(id),null);
 await db.query('update bentan_feedback_notification_config set enabled=true');const n=await claim(id);
 await db.query("select feedback_notification_finish($1,$2,'retry',null,null)",[id,n.lease]);
 await db.query("update bentan_feedback_notifications set next_attempt_at=null,first_attempt_at=now()-interval '24 hours' where feedback_id=$1",[id]);
 assert.equal(await claim(id),null);assert.equal((await db.query('select status from bentan_feedback_notifications where feedback_id=$1',[id])).rows[0].status,'blocked');
 const otherId=await submit(),p=await claim(otherId);
 await db.query("select feedback_notification_finish($1,$2,'retry',null,null)",[otherId,p.lease]);
 await db.query('update bentan_feedback_notifications set next_attempt_at=null where feedback_id=$1',[otherId]);
 await db.query('update bentan_feedback_notification_config set recipient=$1',['U'+'b'.repeat(32)]);
 assert.equal(await claim(otherId),null);await db.query('update bentan_feedback_notification_config set recipient=$1',[recipient]);
});
test('new tables and RPCs remain inaccessible to public and ordinary authenticated clients',async()=>{
 for(const role of ['anon','authenticated']){
  for(const table of ['bentan_feedback','bentan_feedback_notifications','bentan_feedback_notification_config'])assert.equal((await db.query(`select has_table_privilege('${role}','${table}','select') ok`)).rows[0].ok,false);
  for(const fn of ['feedback_inbox_summary(uuid,uuid)','review_bentan_feedback(uuid,uuid,uuid)','feedback_notification_claim(uuid)','feedback_notification_finish(uuid,uuid,text,text,text)'])assert.equal((await db.query(`select has_function_privilege('${role}','${fn}','execute') ok`)).rows[0].ok,false);
 }
 await db.exec(migration);
});
test('LINE success, accepted retry, temporary failure and permanent failure are recorded correctly',async()=>{
 for(const [status,headers,expected] of [[200,{},'sent'],[409,{'x-line-accepted-request-id':'already'},'sent'],[503,{},'retry'],[429,{},'retry'],[403,{},'blocked']]){
  let claimed=false;const finished=[];const key=randomUUID();
  const n={feedback_id:randomUUID(),recipient,message:'【勉たん】改善のご意見が届きました。\nhttps://line-check-system.vercel.app/private-feedback',retry_key:key,lease:randomUUID()};
  const fake={rpc:async(name,args)=>{if(name==='feedback_notification_claim'){if(claimed)return{data:null};claimed=true;return{data:n};}finished.push(args);return{data:true};}};
  await sendFeedbackNotifications({db:fake,token:'isolated-test',request:async(url,options)=>{assert.equal(url,'https://api.line.me/v2/bot/message/push');assert.equal(options.headers['X-Line-Retry-Key'],key);assert.equal(JSON.parse(options.body).to,recipient);return new Response('{}',{status,headers});}});
  assert.equal(finished[0].p_result,expected);
 }
});
test('missing tokens do not claim notifications; ambiguous network failure keeps them retryable',async()=>{
 let calls=0;assert.equal((await sendFeedbackNotifications({db:{rpc:()=>{calls++;}},token:undefined})).status,'unavailable');assert.equal(calls,0);
 const completed=[];const fake={rpc:async(name,args)=>name==='feedback_notification_claim'?{data:{feedback_id:randomUUID(),recipient,message:'【勉たん】改善のご意見が届きました。',retry_key:randomUUID(),lease:randomUUID()}}:(completed.push(args),{data:true})};
 await sendFeedbackNotifications({db:fake,token:'test',limit:1,request:async()=>{throw Error('timeout');}});assert.equal(completed[0].p_result,'retry');
});

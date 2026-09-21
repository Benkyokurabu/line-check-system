import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {invitationStudents,filterInvitationStudents} from '../src/lib/interview-invitation-students.mjs';
import {sendPilotNotification} from '../src/lib/interview-pilot-notification.mjs';

test('アンケートは対象回の回答だけで判定し、担任・日付・提出状況を組み合わせる',()=>{
 const students=[{id:'a',student_number:'1',student_name:'生徒A',homeroom_teacher:'工藤',enrollment_status:'current_roster'},{id:'b',student_number:'2',student_name:'生徒B',homeroom_teacher:'先生B',enrollment_status:'current_roster'},{id:'c',student_number:'3',student_name:'生徒C',homeroom_teacher:'工藤',enrollment_status:'current_roster'}];
 const rows=[{student_number:'1',source_name:'面談',round_label:'2',answered_at:'2026-09-20',link_status:'linked'},{student_number:'2',source_name:'面談',round_label:'1',answered_at:'2026-06-10',link_status:'linked'},{student_number:'3',source_name:'面談',round_label:'2',answered_at:'2026-09-21',link_status:'candidate'}];
 const data=invitationStudents(students,rows),round=data.rounds[0].id;
 assert.equal(data.students[1].surveys.find(s=>s.round===round).status,'missing');
 assert.deepEqual(filterInvitationStudents(data.students,{round,teacher:'工藤',status:'submitted',from:'2026-09-19'}).map(s=>s.number),['1']);
 assert.deepEqual(filterInvitationStudents(data.students,{round,sort:'missing'}).map(s=>s.number),['2','3','1']);
 assert.equal(filterInvitationStudents(data.students,{round,query:'３'})[0].answer.status,'unknown');
 assert.equal(filterInvitationStudents(data.students,{round,from:'2026-09-22'}).length,0);
});

test('通知は固定宛先と同一retry keyを使い、409受付済み・通信不明・他職員を区別する',async()=>{
 const calls=[],rpc=[];const notification={recipient:'U'+'1'.repeat(32),message:'【工藤専用・動作確認】テスト',retry_key:randomUUID(),lease:randomUUID()};
 const db={rpc:async(name,args)=>{rpc.push({name,args});return {data:name.endsWith('_claim')?notification:true,error:null}}};
 const request=async(url,options)=>{calls.push({url,options});return new Response('',{status:409,headers:{'x-line-accepted-request-id':'accepted'}})};
 assert.equal((await sendPilotNotification({db,bookingId:randomUUID(),staffCode:'OTHER',token:'test',request})).status,'not_applicable');assert.equal(rpc.length,0);
 const id=randomUUID();assert.equal((await sendPilotNotification({db,invitationId:id,staffCode:'KUDO',token:'test',request})).status,'sent');
 assert.equal(calls[0].options.headers['X-Line-Retry-Key'],notification.retry_key);assert.equal(JSON.parse(calls[0].options.body).to,notification.recipient);assert.equal(rpc[1].args.p_invitation,id);
 assert.equal((await sendPilotNotification({db,bookingId:id,staffCode:'KUDO',token:'test',request:async()=>{throw Error('timeout')}})).status,'retry');
 assert.equal(rpc.at(-1).args.p_result,'retry');
});

test('本番パイロットのDB制限・案内範囲・期限・承認・通知・取消を通し検証',async()=>{
 const db=new PGlite(),actor=randomUUID(),user=randomUUID(),session=randomUUID(),recipient='U'+'1'.repeat(32),line='BENTAN-KUDO-INTERVIEW-LIVE-PREVIEW',hash='a'.repeat(64);
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table staff_accounts(id uuid primary key,role text,staff_code text,active boolean default true);
 create table student_registry(student_number text primary key,notion_page_id uuid,student_name text,grade text,homeroom_teacher text,enrollment_status text default 'current_roster',updated_at timestamptz default now());
 create table student_line_accounts(student_number text references student_registry(student_number),line_user_id text,relation text,verification_status text);
 create table lessons(id uuid primary key,updated_at timestamptz default now());
 create table line_messages(line_message_id text unique,line_user_id text,direction text,message_type text,text text,sent_by text,received_at timestamptz,raw_event jsonb);
 create function staff_authorize(uuid,uuid,text,boolean) returns jsonb language sql as $$select jsonb_build_object('staffId',id,'role',role,'staffCode',staff_code) from staff_accounts limit 1$$;`);
 await db.query("insert into staff_accounts values($1,'admin','KUDO',true)",[actor]);
 await db.exec("insert into student_registry(student_number,student_name,homeroom_teacher) values('2018999','工藤検証','工藤'),('other','別の生徒','工藤')");
 for(const file of ['interviews_20260914','interview_student_identity_20260914','interview_bensuke_20260916','interview_requests_20260916','interview_parent_cancel_20260918','interview_auto_availability_20260921','interview_pilot_notifications_20260921','interview_invitations_20260921'])await db.exec(await readFile(new URL(`../supabase/${file}.sql`,import.meta.url),'utf8'));
 const student=await value("select id v from interview_students where student_number='2018999'"),other=await value("select id v from interview_students where student_number='other'");
 await db.query("insert into student_line_accounts values('2018999',$1,'student','confirmed'),('2018999',$2,'student','confirmed')",[line,recipient]);
 await db.query("insert into interview_parent_sessions values($1,$2,now()+interval '1 day',now())",[hash,line]);
 await db.query('insert into interview_pilot_notification_config(staff_id,recipient,enabled) values($1,$2,true)',[actor,recipient]);
 const publish=async(n)=>{const date=await value("select ((now() at time zone 'Asia/Tokyo')::date+$1::int)::text v",[n]);const data={studentId:student,teacher:'工藤',date,start:'13:00',end:'13:45',busyStart:'13:00',busyEnd:'14:00',campus:'本校',room:'',method:'Zoom',purpose:'保護者面談',participants:'保護者',channel:'LINE',note:''};return value('select interview_publish_slot($1,$2,$3,$4,$5,$6,true) v',[user,session,randomUUID(),randomUUID(),JSON.stringify(data),'2026-09-21T00:00:00Z'])};
 const a=await publish(3),b=await publish(4),expires=new Date(Date.now()+86400000).toISOString();
 const create=(id=student,key=randomUUID(),time=expires)=>value("select interview_invitation_save($1,$2,$3,'create',$4,$5,$6,null,null) v",[user,session,key,id,JSON.stringify([{id:a.id,version:a.version}]),time]);
 await assert.rejects(()=>create(other),/pilot_only/);
 await assert.rejects(()=>create(student,randomUUID(),new Date(Date.now()-1000).toISOString()),/invalid_invitation/);
 const key=randomUUID(),i=await create(student,key);assert.equal((await create(student,key)).id,i.id);
 await assert.rejects(()=>create(),/invitation_already_active/);
 const submit=(ids,version=i.version,inv=i.id,op=randomUUID())=>value('select interview_invited_submit($1,$2,$3,$4,$5,$6,$7) v',[hash,op,student,ids,'検証',inv,version]);
 await assert.rejects(()=>submit([b.id]),/invitation_slot_denied/);
 await assert.rejects(()=>submit([a.id],99),/invitation_required/);
 const claim=()=>value('select interview_invitation_notification_claim($1) v',[i.id]);const first=await claim();assert.equal(first.recipient,recipient);assert.equal(await claim(),null);
 await value("select interview_invitation_notification_finish($1,$2,'retry',null,'network') v",[i.id,first.lease]);await db.query('update interview_invitations set next_attempt_at=null where id=$1',[i.id]);const second=await claim();assert.equal(first.retry_key,second.retry_key);
 await value("select interview_invitation_notification_finish($1,$2,'sent','accepted',null) v",[i.id,second.lease]);assert.equal(await claim(),null);assert.equal(await value('select count(*)::int v from line_messages'),1);
 const op=randomUUID(),r=await submit([a.id],i.version,i.id,op);assert.equal(r.invitation_id,i.id);assert.equal((await submit([a.id],i.version,i.id,op)).id,r.id);
 const baseline={title:'予約可',date:{start:a.data.date+'T13:00:00+09:00',end:a.data.date+'T13:45:00+09:00'},teachers:[],campuses:['本校'],room:'',tags:['本：予約可']};
 const data={...a.data,studentId:student,bensuke:{pageId:a.notion_page_id,sourceId:'19ef0120-80a7-80c4-a965-000b104ea319',editedAt:a.notion_edited_at,baseline}};
 const approved=await value("select interview_review_request($1,$2,$3,$4,$5,'approve',$6,$7,$8,'',$9) v",[user,session,randomUUID(),r.id,r.version,a.id,await value('select interview_snapshot() v'),JSON.stringify(data),'approve']);
 assert.equal(await value('select interview_pilot_notification_claim($1) v',[approved.booking_id]),null);
 await db.query('update interview_bookings set notion_synced_version=version where id=$1',[approved.booking_id]);
 const n=await value('select interview_pilot_notification_claim($1) v',[approved.booking_id]);assert.equal(n.recipient,recipient);
 await value("select interview_pilot_notification_finish($1,$2,'sent','ok',null) v",[approved.booking_id,n.lease]);assert.equal(await value('select count(*)::int v from line_messages'),2);
 await assert.rejects(()=>value("select interview_invitation_save($1,$2,$3,'revoke',null,null,null,$4,$5) v",[user,session,randomUUID(),i.id,i.version]),/request_already_active/);
 await value('select interview_parent_withdraw($1,$2,$3,$4) v',[hash,randomUUID(),approved.id,approved.version]);
 await value("select interview_invitation_save($1,$2,$3,'revoke',null,null,null,$4,$5) v",[user,session,randomUUID(),i.id,i.version]);
 await assert.rejects(()=>submit([a.id]),/invitation_required/);
 await db.exec('set role anon');await assert.rejects(()=>db.query('select * from interview_invitations'),/permission denied/);await assert.rejects(()=>claim(),/permission denied/);await db.exec('reset role');
 await db.exec("update staff_accounts set staff_code='OTHER'");await assert.rejects(()=>create(),/staff_permission_denied/);
 }finally{await db.close()}
});

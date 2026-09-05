import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Auth tables below are isolated fixtures, NOT a live Auth service or password test.
const db = new PGlite();
const userId = randomUUID();
const sessionId = randomUUID();
let staffId;
const migration = await readFile(new URL("../supabase/staff_auth_20260905.sql", import.meta.url), "utf8");

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,banned_until timestamptz,encrypted_password text);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),
      created_at timestamptz not null default now(),not_after timestamptz);
  `);
  const base = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  for (const table of ["student_roster", "student_line_accounts"]) {
    const definition = base.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition);
    await db.exec(definition[0]);
  }
  await db.exec("alter table public.student_line_accounts add column verification_status text default 'unverified';");
  for (const file of ["self_study_room_schema.sql", "self_study_room_workflow_20260905.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/${file}`, import.meta.url), "utf8"));
  }
  await db.exec(migration);
  await db.exec(await readFile(new URL("../supabase/staff_study_room_read_20260905.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/staff_study_room_intake_20260905.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/staff_study_room_options_20260905.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/staff_study_room_visits_20260905.sql", import.meta.url), "utf8"));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate public.study_room_visits,public.study_room_visit_events,public.study_room_staff_intakes, public.study_room_notification_intents, public.study_room_request_events,
    public.study_room_reservations, public.study_room_requests, public.study_room_day_settings,
    public.student_line_accounts, public.student_roster;
    update public.study_room_workflow_settings set enabled=true;`);
  await db.exec(`truncate public.study_room_visits,public.study_room_visit_events,public.study_room_staff_intakes,public.staff_session_activity,public.staff_permission_overrides,public.staff_accounts,
    public.staff_login_buckets,auth.sessions,auth.users;
    update public.staff_auth_settings set enabled=true,idle_seconds=1800,absolute_seconds=28800;
    delete from public.staff_role_permissions;
    insert into public.staff_role_permissions values ('office','study_room.approve'),('office','study_room.read'),('office','study_room.cancel'),('office','study_room.submit');
    insert into public.staff_role_permissions values ('office','study_room.visit');
  `);
  await db.query("insert into auth.users(id,email,encrypted_password) values ($1,'staff@example.invalid','fixture-password-hash')", [userId]);
  staffId = (await db.query(`insert into public.staff_accounts(auth_user_id,staff_code,display_name,role,active)
    values ($1,'TEST01','Test Staff','office',true) returning id`, [userId])).rows[0].id;
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [sessionId, userId]);
});

async function visitFixture() {
  await authorize({initialize:true});
  await db.exec("insert into public.student_roster(student_number,grade,student_name,homeroom_teacher) values ('visit-test','中1','Visit Student','Teacher');");
  const day=(await db.query("select (clock_timestamp() at time zone 'Asia/Tokyo')::date::text as day")).rows[0].day;
  const submitted=(await db.query("select public.staff_study_room_submit($1,$2,$3,'visit-test',$4,1,array['14:55-16:25'],'in_person','来室希望') result",[userId,sessionId,randomUUID(),day])).rows[0].result.request;
  const approved=(await db.query("select public.staff_study_room_transition($1,$2,$3,$4,1,'approve','') result",[userId,sessionId,randomUUID(),submitted.id])).rows[0].result.request;
  const start=`${day}T00:00:00+09:00`;
  const save=(version=0,ended=null,destination=null,reason='',key=randomUUID(),started=start)=>db.query(
    'select public.staff_study_room_save_visit($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
    [userId,sessionId,key,approved.id,version,started,ended,destination,reason]);
  return {save,start,approved};
}

test('visit arrival, departure to lesson and corrections preserve inventory and audit every change',async()=>{
  const {save,start,approved}=await visitFixture();
  const notificationCount=Number((await db.query('select count(*) n from public.study_room_notification_intents')).rows[0].n);
  const key=randomUUID();
  await db.exec('set role service_role;');
  let first;
  try {first=(await save(0,null,null,'',key)).rows[0].result;} finally {await db.exec('reset role;');}
  assert.equal(first.visit.version,1);assert.equal(first.visit.ended_at,null);
  assert.equal(first.visit.confirmed_by,staffId);
  const listed=(await db.query('select public.staff_study_room_requests($1,$2,$3) result',[userId,sessionId,approved.reservation_date])).rows[0].result;
  assert.equal(listed.permissions['study_room.visit'],true);
  assert.equal(listed.requests[0].visit.version,1);
  assert.equal(listed.requests[0].visit.staff_name,'Test Staff');
  assert.equal('confirmed_by' in listed.requests[0].visit,false);
  assert.equal((await save(0,null,null,'',key)).rows[0].result.replayed,true);
  await assert.rejects(save(0,null,null,'違う理由',key),/idempotency_conflict/);
  await assert.rejects(save(0),/version_conflict/);
  await assert.rejects(save(1,null,null,'',randomUUID(),null),/reason_required/);
  const departed=(await save(1,start,'lesson')).rows[0].result.visit;
  assert.equal(departed.destination,'lesson');
  const corrected=(await save(2,start,'home','移動先の確認を訂正')).rows[0].result.visit;
  assert.equal(corrected.destination,'home');
  const events=(await db.query('select * from public.study_room_visit_events order by version')).rows;
  assert.equal(events.length,3);assert.equal(events[2].before_state.destination,'lesson');
  assert.equal(Number((await db.query("select count(*) n from public.study_room_reservations where status='active'")).rows[0].n),1);
  assert.equal(Number((await db.query('select count(*) n from public.study_room_notification_intents')).rows[0].n),notificationCount);
  const request=(await db.query('select status,version from public.study_room_requests where id=$1',[approved.id])).rows[0];
  assert.deepEqual(request,{status:'approved',version:2});
  const cleared=(await save(3,null,null,'記録した生徒を取り違えたため訂正',randomUUID(),null)).rows[0].result.visit;
  assert.equal(cleared.started_at,null);assert.equal(cleared.version,4);
});

test('visit rejects impossible times, denied permissions and unauthenticated database access',async()=>{
  const {save,start}=await visitFixture();
  await assert.rejects(save(0,start,'home','',randomUUID(),null),/invalid_visit_time/);
  await assert.rejects(save(0,'2099-01-01T00:00:00Z','home'),/invalid_visit_time/);
  await assert.rejects(save(0,null,'home'),/invalid_visit_time/);
  await db.query("insert into public.staff_permission_overrides values ($1,'study_room.visit',false)",[staffId]);
  await assert.rejects(save(),/staff_permission_denied/);
  const rights=(await db.query(`select
    has_function_privilege('anon','public.staff_study_room_save_visit(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text)','EXECUTE') a,
    has_function_privilege('authenticated','public.staff_study_room_save_visit(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz,text,text)','EXECUTE') b,
    has_table_privilege('service_role','public.study_room_visit_events','UPDATE') c,
    has_table_privilege('service_role','public.study_room_visit_events','DELETE') d`)).rows[0];
  assert.deepEqual(rights,{a:false,b:false,c:false,d:false});
});

test('visit audit failure rolls back facts and migration never restores revoked permissions',async()=>{
  const {save}=await visitFixture();
  await db.exec("alter table public.study_room_visit_events add constraint test_visit_failure check(reason='never');");
  try {await assert.rejects(save(),/test_visit_failure/);} finally {await db.exec('alter table public.study_room_visit_events drop constraint test_visit_failure;');}
  assert.equal(Number((await db.query('select count(*) n from public.study_room_visits')).rows[0].n),0);
  await db.exec("delete from public.staff_role_permissions where permission='study_room.visit';");
  await db.exec(await readFile(new URL('../supabase/staff_study_room_visits_20260905.sql',import.meta.url),'utf8'));
  await assert.rejects(save(),/staff_permission_denied/);
});

test('cancelled visits retain facts for correction but unapproved requests cannot record arrivals',async()=>{
  const {save,approved}=await visitFixture();
  await save();
  await db.query("select public.staff_study_room_transition($1,$2,$3,$4,2,'cancel','利用取消')",[userId,sessionId,randomUUID(),approved.id]);
  const corrected=(await save(1,null,null,'利用取消後に誤った来室記録を訂正',randomUUID(),null)).rows[0].result.visit;
  assert.equal(corrected.started_at,null);
  const pendingSubmit=await proxyFixture();
  const pending=(await pendingSubmit()).rows[0].result.request;
  await assert.rejects(db.query("select public.staff_study_room_save_visit($1,$2,$3,$4,0,clock_timestamp(),null,null,'')",[userId,sessionId,randomUUID(),pending.id]),/invalid_state_transition/);
});

async function authorize({ user = userId, session = sessionId, permission = null, initialize = false } = {}) {
  return (await db.query("select public.staff_authorize($1,$2,$3,$4) as result", [user, session, permission, initialize])).rows[0].result;
}
async function target(code = "TEST01") {
  return (await db.query("select public.staff_login_target($1) as result", [code])).rows[0].result;
}

test("staff migration is repeatable, initially disabled and does not provision users", async () => {
  await db.exec("update public.staff_auth_settings set enabled=false;");
  await db.exec(migration);
  await assert.rejects(target(), /staff_auth_disabled/);
  assert.equal(Number((await db.query("select count(*) n from auth.users")).rows[0].n), 1);
});
test("rerunning migration never restores deliberately removed role permissions", async () => {
  await db.exec("delete from public.staff_role_permissions where permission='study_room.approve';");
  await db.exec(migration);
  await authorize({ initialize: true });
  await assert.rejects(authorize({ permission: "study_room.approve" }), /staff_permission_denied/);
});
test("staff wrapper atomically checks permission and records the verified staff approver", async () => {
  await db.exec(`update public.study_room_workflow_settings set enabled=true;
    insert into public.student_roster(student_number,grade,student_name,homeroom_teacher)
      values ('staff-test-student','test','Student','Teacher');
    insert into public.student_line_accounts(student_number,line_user_id,relation,verification_status)
      values ('staff-test-student','staff-test-line','student','confirmed');`);
  const day = (await db.query("select ((clock_timestamp() at time zone 'Asia/Tokyo')::date + 1)::text as day")).rows[0].day;
  const { request } = (await db.query("select public.study_room_submit_request($1,$2,$3,1,$4,'student',$5,'line_screen') result",
    [randomUUID(), "staff-test-student", day, ["14:55-16:25"], "staff-test-line"])).rows[0].result;
  await authorize({ initialize: true });
  await db.query("insert into public.staff_permission_overrides values ($1,'study_room.approve',false)", [staffId]);
  const args = [userId, sessionId, randomUUID(), request.id, request.version];
  const approve = () => db.query("select public.staff_study_room_transition($1,$2,$3,$4,$5,'approve','') result", args);
  await assert.rejects(approve(), /staff_permission_denied/);
  assert.equal(Number((await db.query("select count(*) n from public.study_room_reservations")).rows[0].n), 0);
  await db.query("update public.staff_permission_overrides set allowed=true where staff_id=$1", [staffId]);
  const approved = (await approve()).rows[0].result.request;
  assert.equal(approved.status, "approved");
  assert.equal(approved.approved_by, staffId);
  assert.equal(Number((await db.query("select count(*) n from public.study_room_reservations where status='active'")).rows[0].n), 1);
});
test("only active linked staff produce a managed login target and no password hash is returned", async () => {
  assert.deepEqual(await target(), { limited: false, authUserId: userId, email: "staff@example.invalid" });
  assert.deepEqual(await target("missing"), { limited: false });
  await db.exec("update public.staff_accounts set active=false;");
  assert.deepEqual(await target(), { limited: false });
});
test("login attempts are bounded per account and unknown codes cannot grow the bucket table", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await target()).limited, false);
  assert.equal((await target()).limited, true);
  for (let i = 0; i < 20; i++) await target(`unknown-${i}`);
  assert.equal(Number((await db.query("select count(*) n from public.staff_login_buckets")).rows[0].n), 2);
  await db.exec("update public.staff_login_buckets set started_at=now()-interval '1 hour';");
  assert.equal((await target()).limited, false);
});
test("an uninitialized managed session is not accepted as an application login", async () => {
  await assert.rejects(authorize(), /staff_session_invalid/);
  const staff = await authorize({ initialize: true });
  assert.equal(staff.staffId, staffId);
  assert.equal(staff.staffCode, "TEST01");
  assert.deepEqual(Object.keys(staff).sort(), ["displayName","expiresAt","role","staffCode","staffId"]);
});
test("unknown identities and cross-user session IDs fail closed", async () => {
  await assert.rejects(authorize({ user: randomUUID(), initialize: true }), /staff_access_denied/);
  await assert.rejects(authorize({ session: randomUUID(), initialize: true }), /staff_session_invalid/);
  const otherUser = randomUUID();
  await db.query("insert into auth.users(id) values ($1)", [otherUser]);
  await db.query("update auth.sessions set user_id=$1", [otherUser]);
  await assert.rejects(authorize({ initialize: true }), /staff_session_invalid/);
});
test("role permissions and individual denials are checked on each operation", async () => {
  await authorize({ initialize: true });
  await authorize({ permission: "study_room.approve" });
  await db.query("insert into public.staff_permission_overrides values ($1,'study_room.approve',false)", [staffId]);
  await assert.rejects(authorize({ permission: "study_room.approve" }), /staff_permission_denied/);
  await authorize({ permission: "study_room.read" });
  await assert.rejects(authorize({ permission: "not-defined" }), /staff_permission_denied/);
});
test("teachers need an explicit override to approve", async () => {
  await db.exec("update public.staff_accounts set role='teacher';");
  await authorize({ initialize: true });
  await assert.rejects(authorize({ permission: "study_room.approve" }), /staff_permission_denied/);
  await db.query("insert into public.staff_permission_overrides values ($1,'study_room.approve',true)", [staffId]);
  await authorize({ permission: "study_room.approve" });
});
test("disable followed by reenable does not revive previous sessions", async () => {
  await authorize({ initialize: true });
  await db.exec("update public.staff_accounts set active=false;");
  await assert.rejects(authorize(), /staff_access_denied/);
  await db.exec("update public.staff_accounts set active=true;");
  await assert.rejects(authorize(), /staff_session_invalid/);
});
test("managed logout and password changes invalidate application authorization", async () => {
  await authorize({ initialize: true });
  await db.exec("update auth.users set encrypted_password='changed-fixture-hash';");
  await assert.rejects(authorize(), /staff_session_invalid/);
  await db.exec("delete from auth.sessions;");
  await assert.rejects(authorize(), /staff_session_invalid/);
});
test("account bans, absolute expiry, idle expiry and managed expiry are enforced", async () => {
  await authorize({ initialize: true });
  await db.exec("update auth.users set banned_until=now()+interval '1 day';");
  await assert.rejects(authorize(), /staff_session_invalid/);
  await db.exec("update auth.users set banned_until=null; update auth.sessions set not_after=now()-interval '1 second';");
  await assert.rejects(authorize(), /staff_session_expired/);
  await db.exec("update auth.sessions set not_after=null; update public.staff_session_activity set last_seen_at=now()-interval '31 minutes';");
  await assert.rejects(authorize(), /staff_session_expired/);
  await db.exec("update public.staff_session_activity set last_seen_at=now(); update public.staff_accounts set auth_not_before=now()-interval '2 days'; update auth.sessions set created_at=now()-interval '9 hours';");
  await assert.rejects(authorize(), /staff_session_expired/);
});
test("public and authenticated roles cannot call staff RPCs or read the staff roster", async () => {
  const { rows } = await db.query(`select
    has_function_privilege('anon','public.staff_login_target(text)','EXECUTE') a,
    has_function_privilege('authenticated','public.staff_authorize(uuid,uuid,text,boolean)','EXECUTE') b,
    has_function_privilege('authenticated','public.staff_study_room_transition(uuid,uuid,uuid,uuid,integer,text,text)','EXECUTE') c,
    has_table_privilege('authenticated','public.staff_accounts','SELECT') d`);
  assert.deepEqual(rows[0], { a: false, b: false, c: false, d: false });
});
test("service role uses the definer functions without direct access to managed auth tables", async () => {
  await db.exec("set role service_role;");
  try {
    await target();
    assert.equal((await authorize({ initialize: true })).staffId, staffId);
  } finally { await db.exec("reset role;"); }
});

test("request reads require read permission, omit LINE identities and preserve pagination", async () => {
  await authorize({ initialize: true });
  await db.exec(`insert into public.student_roster(student_number,grade,student_name,homeroom_teacher)
    values ('read-test','test','Student','Teacher');
    insert into public.study_room_requests(student_number,reservation_date,seat,slot_ids,actor_kind,actor_id,intake_channel,request_kind)
    select 'read-test','2030-01-01',1,array['14:55-16:25'],'guardian','private-line-id','line_screen','advance'
      from generate_series(1,51);`);
  const read = (offset = 0, status = null) => db.query("select public.staff_study_room_requests($1,$2,'2030-01-01',$3,$4) result", [userId, sessionId, status, offset]);
  const first = (await read()).rows[0].result;
  const second = (await read(50)).rows[0].result;
  assert.equal(first.requests.length, 50); assert.equal(first.hasMore, true);
  assert.equal(second.requests.length, 1); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.requests, ...second.requests].map(r => r.id)).size, 51);
  assert.equal(JSON.stringify(first).includes('private-line-id'), false);
  assert.equal(first.permissions['study_room.approve'], true);
  assert.equal((await read(0,'approved')).rows[0].result.requests.length, 0);
  await db.query("insert into public.staff_permission_overrides values ($1,'study_room.read',false)", [staffId]);
  await assert.rejects(read(), /staff_permission_denied/);
});
test("request read RPC is not executable by browser roles and refuses disabled workflow", async () => {
  await authorize({ initialize: true });
  const privileges = (await db.query(`select has_function_privilege('anon','public.staff_study_room_requests(uuid,uuid,date,text,integer)','EXECUTE') a,
    has_function_privilege('authenticated','public.staff_study_room_requests(uuid,uuid,date,text,integer)','EXECUTE') b`)).rows[0];
  assert.deepEqual(privileges,{ a:false,b:false });
  await db.exec("update public.study_room_workflow_settings set enabled=false;");
  await assert.rejects(db.query("select public.staff_study_room_requests($1,$2,'2030-01-01')", [userId,sessionId]), /workflow_disabled/);
});

async function proxyFixture() {
  await authorize({ initialize:true });
  await db.exec(`insert into public.student_roster(student_number,grade,student_name,homeroom_teacher)
    values ('proxy-test','test','Proxy Student','Teacher');`);
  const day = (await db.query("select ((clock_timestamp() at time zone 'Asia/Tokyo')::date + 1)::text as day")).rows[0].day;
  const key = randomUUID();
  return (note = 'LINEで例外利用の連絡を確認', channel = 'line_message') => db.query(
    "select public.staff_study_room_submit($1,$2,$3,'proxy-test',$4,1,array['14:55-16:25'],$5,$6) result",
    [userId,sessionId,key,day,channel,note]);
}
test("staff proxy intake keeps the staff actor, contact reason and pending-only state", async () => {
  const submit = await proxyFixture();
  await db.exec("set role service_role;");
  let result;
  try { result = (await submit()).rows[0].result; }
  finally { await db.exec("reset role;"); }
  assert.equal(result.request.status,'pending');
  assert.equal(result.request.actor_kind,'staff');
  assert.equal(result.request.actor_id,staffId);
  assert.equal(result.request.approved_at,null);
  const saved = (await db.query("select * from public.study_room_staff_intakes")).rows[0];
  assert.equal(saved.contact_channel,'line_message');
  assert.equal(saved.note,'LINEで例外利用の連絡を確認');
  const listed=(await db.query('select public.staff_study_room_requests($1,$2,$3) result',[userId,sessionId,result.request.reservation_date])).rows[0].result;
  assert.equal(listed.requests[0].staff_intake.note,saved.note);
  assert.equal(listed.requests[0].staff_intake.staffName,'Test Staff');
  assert.deepEqual(Object.keys(listed.requests[0].staff_intake).sort(),['contactChannel','createdAt','note','staffCode','staffName']);
  assert.equal(Number((await db.query("select count(*) n from public.study_room_reservations")).rows[0].n),0);
  assert.equal(Number((await db.query("select count(*) n from public.study_room_notification_intents")).rows[0].n),0);
  assert.equal((await submit()).rows[0].result.replayed,true);
  await assert.rejects(submit('違う内容'),/idempotency_conflict/);
  await assert.rejects(submit('LINEで例外利用の連絡を確認','in_person'),/idempotency_conflict/);
});
test("proxy requires permission and reason and never restores revoked permission on migration rerun", async () => {
  const submit = await proxyFixture();
  await assert.rejects(submit('  '),/invalid_request/);
  await db.exec("delete from public.staff_role_permissions where permission='study_room.submit';");
  await db.exec(await readFile(new URL("../supabase/staff_study_room_intake_20260905.sql",import.meta.url),'utf8'));
  await assert.rejects(submit(),/staff_permission_denied/);
  assert.equal(Number((await db.query("select count(*) n from public.study_room_requests")).rows[0].n),0);
});
test("failure saving proxy evidence rolls back the request and event too", async () => {
  const submit = await proxyFixture();
  await db.exec("alter table public.study_room_staff_intakes add constraint test_reject_evidence check (note='never');");
  try { await assert.rejects(submit(),/test_reject_evidence/); }
  finally { await db.exec("alter table public.study_room_staff_intakes drop constraint test_reject_evidence;"); }
  assert.equal(Number((await db.query("select count(*) n from public.study_room_requests")).rows[0].n),0);
  assert.equal(Number((await db.query("select count(*) n from public.study_room_request_events")).rows[0].n),0);
});
test("proxy intake cannot bypass closures and browser roles cannot invoke it or alter evidence", async () => {
  const submit = await proxyFixture();
  await db.exec(`insert into public.study_room_day_settings(reservation_date,closed_slot_ids)
    values ((clock_timestamp() at time zone 'Asia/Tokyo')::date+1,'["14:55-16:25"]'::jsonb);`);
  await assert.rejects(submit(),/slot_closed/);
  const rights = (await db.query(`select
    has_function_privilege('anon','public.staff_study_room_submit(uuid,uuid,uuid,text,date,integer,text[],text,text)','EXECUTE') a,
    has_function_privilege('authenticated','public.staff_study_room_submit(uuid,uuid,uuid,text,date,integer,text[],text,text)','EXECUTE') b,
    has_table_privilege('service_role','public.study_room_staff_intakes','UPDATE') c,
    has_table_privilege('service_role','public.study_room_staff_intakes','DELETE') d`)).rows[0];
  assert.deepEqual(rights,{a:false,b:false,c:false,d:false});
});
test("proxy search includes South pupils but returns no LINE identifiers or other pupil booking details", async () => {
  await authorize({initialize:true});
  await db.exec(`insert into public.student_roster(student_number,student_name,grade,campus,homeroom_teacher)
    values ('south-proxy','南の生徒','中1','南教室','Teacher');`);
  const result = (await db.query("select public.staff_study_room_intake_options($1,$2,'2030-01-01','南','south-proxy') result",[userId,sessionId])).rows[0].result;
  assert.equal(result.students.length,1);
  assert.equal(result.student.campus,'南教室');
  assert.deepEqual(result.booked,[]);
  assert.deepEqual(result.pendingSlotIds,[]);
  assert.deepEqual(result.studentSlotIds,[]);
  assert.deepEqual(Object.keys(result.student).sort(),['campus','grade','student_name','student_number']);
  await db.query("insert into public.staff_permission_overrides values ($1,'study_room.submit',false)",[staffId]);
  await assert.rejects(db.query("select public.staff_study_room_intake_options($1,$2,'2030-01-01','南')",[userId,sessionId]),/staff_permission_denied/);
});

test('proxy options separate own slot conflicts from anonymous seat occupancy and bound search',async()=>{
  await authorize({initialize:true});
  await db.exec(`insert into public.student_roster(student_number,student_name,grade,homeroom_teacher)
    select 'search-'||n,'検索 生徒 '||n,'中1','Teacher' from generate_series(1,25) n;
    update public.study_room_workflow_settings set enabled=false;
    insert into public.study_room_reservations(student_number,reservation_date,seat,slot_id,start_time,end_time,grade,student_name,minutes,status)
    values ('search-1','2030-01-01',8,'14:55-16:25','14:55','16:25','中1','検索 生徒 1',90,'active'),
      ('search-2','2030-01-01',1,'16:45-18:15','16:45','18:15','中1','検索 生徒 2',90,'active');
    update public.study_room_workflow_settings set enabled=true;`);
  const read=()=>db.query("select public.staff_study_room_intake_options($1,$2,'2030-01-01','検索生徒','search-1') result",[userId,sessionId]);
  await db.exec('set role service_role;');
  let result;
  try {result=(await read()).rows[0].result;} finally {await db.exec('reset role;');}
  assert.equal(result.hasMore,true);assert.equal(result.students.length,20);
  assert.equal(result.studentMinutes,90);assert.deepEqual(result.studentSlotIds,['14:55-16:25']);
  assert.equal(result.booked.length,2);
  for(const booked of result.booked) assert.deepEqual(Object.keys(booked).sort(),['seat','slotId']);
  const permissions=(await db.query("select public.staff_study_room_requests($1,$2,'2030-01-01') result",[userId,sessionId])).rows[0].result.permissions;
  assert.equal(permissions['study_room.submit'],true);
  await db.exec('update public.study_room_workflow_settings set enabled=false;');
  await assert.rejects(read(),/workflow_disabled/);
  const rights=(await db.query(`select has_function_privilege('anon','public.staff_study_room_intake_options(uuid,uuid,date,text,text)','EXECUTE') a,
    has_function_privilege('authenticated','public.staff_study_room_intake_options(uuid,uuid,date,text,text)','EXECUTE') b`)).rows[0];
  assert.deepEqual(rights,{a:false,b:false});
});

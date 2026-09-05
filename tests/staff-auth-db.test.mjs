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
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate public.staff_session_activity,public.staff_permission_overrides,public.staff_accounts,
    public.staff_login_buckets,auth.sessions,auth.users;
    update public.staff_auth_settings set enabled=true,idle_seconds=1800,absolute_seconds=28800;
    delete from public.staff_role_permissions;
    insert into public.staff_role_permissions values ('office','study_room.approve'),('office','study_room.read'),('office','study_room.cancel');
  `);
  await db.query("insert into auth.users(id,email,encrypted_password) values ($1,'staff@example.invalid','fixture-password-hash')", [userId]);
  staffId = (await db.query(`insert into public.staff_accounts(auth_user_id,staff_code,display_name,role,active)
    values ($1,'TEST01','Test Staff','office',true) returning id`, [userId])).rows[0].id;
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [sessionId, userId]);
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

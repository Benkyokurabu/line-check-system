import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

// Isolated, in-memory Postgres. No environment files, network or production DB.
// PGlite has one connection: these tests do NOT prove multi-session lock behavior.
const nativeUrl = process.env.STUDY_ROOM_TEST_DATABASE_URL;
if (nativeUrl) {
  const url = new URL(nativeUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/study_room_workflow_test" || !["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Workflow tests require a dedicated local study_room_workflow_test database");
  }
}
async function connectNative() {
  const client = new pg.Client({ connectionString: nativeUrl, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  await client.connect();
  return { query: (sql, params) => client.query(sql, params), exec: (sql) => client.query(sql), close: () => client.end() };
}
const db = nativeUrl ? await connectNative() : new PGlite();
let tomorrow;
const slots = ["14:55-16:25", "16:45-18:15", "18:35-20:05", "20:25-21:55"];
const migration = await readFile(new URL("../supabase/self_study_room_workflow_20260905.sql", import.meta.url), "utf8");

before(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  // Supabase default privileges may grant ALL to service_role. The migration must
  // explicitly remove inherited/default update/delete grants on audit tables.
  await db.exec("alter default privileges in schema public grant all on tables to service_role, anon, authenticated;");
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  for (const table of ["student_roster", "student_line_accounts"]) {
    const definition = schema.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition, `existing ${table} definition`);
    await db.exec(definition[0]);
  }
  await db.exec("alter table public.student_line_accounts add column verification_status text not null default 'unverified';");
  await db.exec(await readFile(new URL("../supabase/self_study_room_schema.sql", import.meta.url), "utf8"));
  await db.exec(migration);
  tomorrow = (await db.query("select ((clock_timestamp() at time zone 'Asia/Tokyo')::date + 1)::text as day")).rows[0].day;
});
after(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`
    truncate public.study_room_notification_intents, public.study_room_request_events,
      public.study_room_reservations, public.study_room_requests, public.study_room_day_settings,
      public.student_line_accounts, public.student_roster;
    update public.study_room_workflow_settings set enabled = true;
    insert into public.student_roster(student_number,grade,student_name,homeroom_teacher)
      values ('test-1','test-grade','Test One','Test Staff'), ('test-2','test-grade','Test Two','Test Staff');
    insert into public.student_line_accounts(student_number,line_user_id,relation,verification_status)
      values ('test-1','student-line','student','confirmed'),
        ('test-1','guardian-line','mother','confirmed'), ('test-2','guardian-line','mother','confirmed');
  `);
});

async function submit(overrides = {}) {
  const input = { key: randomUUID(), student: "test-1", date: tomorrow, seat: 1,
    slots: [slots[0]], kind: "guardian", actor: "guardian-line", channel: "line_screen", ...overrides };
  return (await db.query("select public.study_room_submit_request($1,$2,$3,$4,$5,$6,$7,$8) as result",
    [input.key, input.student, input.date, input.seat, input.slots, input.kind, input.actor, input.channel])).rows[0].result;
}
async function transition(request, action, overrides = {}, connection = db) {
  const input = { key: randomUUID(), version: request.version, kind: "staff", actor: "staff-test", reason: "", ...overrides };
  return (await connection.query("select public.study_room_transition_request($1,$2,$3,$4,$5,$6,$7) as result",
    [input.key, request.id, input.version, action, input.kind, input.actor, input.reason])).rows[0].result;
}
async function count(table, condition = "true") {
  // Table/condition are test constants only.
  return Number((await db.query(`select count(*) as n from public.${table} where ${condition}`)).rows[0].n);
}

test("migration is repeatable and leaves existing active reservations intact", async () => {
  await db.exec("update public.study_room_workflow_settings set enabled = false;");
  await db.exec(`insert into public.study_room_reservations(reservation_date,slot_id,start_time,end_time,seat,student_number,grade,student_name)
    values (current_date + 1,'14:55-16:25','14:55','16:25',1,'test-1','test-grade','Test One');`);
  await db.exec(migration);
  assert.equal(await count("study_room_reservations", "status = 'active'"), 1);
});

test("disabled workflow refuses mutations and has no side effects", async () => {
  await db.exec("update public.study_room_workflow_settings set enabled = false;");
  await assert.rejects(submit(), /workflow_disabled/);
  assert.equal(await count("study_room_requests"), 0);
  assert.equal(await count("study_room_request_events"), 0);
});

test("submission is pending and records guardian separately without reserving inventory", async () => {
  const { request } = await submit();
  assert.equal(request.status, "pending");
  assert.equal(request.actor_id, "guardian-line");
  assert.equal(request.student_number, "test-1");
  assert.equal(request.relation_snapshot, "mother");
  assert.equal(request.request_kind, "advance");
  assert.equal(await count("study_room_reservations"), 0);
  assert.equal(await count("study_room_request_events"), 1);
});

test("same-day applications are accepted and classified using the server Japan date", async () => {
  const today = (await db.query("select (clock_timestamp() at time zone 'Asia/Tokyo')::date::text as day")).rows[0].day;
  const { request } = await submit({ date: today });
  assert.equal(request.request_kind, "same_day");
});

test("request retries are idempotent and changed payloads cannot reuse a key", async () => {
  const key = randomUUID();
  const first = await submit({ key, slots: [slots[1], slots[0]] });
  const retry = await submit({ key, slots: [slots[0], slots[1]] });
  assert.equal(retry.request.id, first.request.id);
  assert.equal(retry.replayed, true);
  await assert.rejects(submit({ key, seat: 2 }), /idempotency_conflict/);
  assert.equal(await count("study_room_requests"), 1);
  assert.equal(await count("study_room_request_events"), 1);
});

test("unknown, unverified and revoked LINE relationships cannot submit or cancel", async () => {
  await assert.rejects(submit({ actor: "someone-else" }), /subject_not_authorized/);
  const { request } = await submit();
  await db.exec("update public.student_line_accounts set verification_status = 'revoked' where line_user_id = 'guardian-line';");
  await assert.rejects(transition(request, "cancel", { kind: "guardian", actor: "guardian-line" }), /subject_not_authorized/);
  await assert.rejects(submit({ student: "test-2" }), /subject_not_authorized/);
});

test("a sibling can be selected only when separately linked", async () => {
  await db.exec("delete from public.student_line_accounts where student_number = 'test-2';");
  await assert.rejects(submit({ student: "test-2" }), /subject_not_authorized/);
  assert.equal((await submit()).request.student_number, "test-1");
});

test("invalid seats, dates, slots and actor/channel mismatches are rejected", async () => {
  for (const input of [{ seat: 0 }, { seat: 11 }, { slots: [] }, { slots: ["bad"] }, { slots: [null] },
    { slots: null }, { date: null }, { channel: "staff" }]) {
    await assert.rejects(submit(input), /invalid_request/);
  }
  await assert.rejects(submit({ date: "2020-01-01" }), /past_date/);
  assert.equal(await count("study_room_requests"), 0);
});

test("the same student cannot accumulate overlapping pending applications", async () => {
  await submit();
  await assert.rejects(submit({ seat: 2 }), /pending_student_slot_conflict/);
});

test("approval creates the whole batch, approval evidence and one durable notification intent", async () => {
  const { request } = await submit({ slots: [slots[0], slots[1]] });
  const key = randomUUID();
  const approved = await transition(request, "approve", { key });
  assert.equal(approved.request.status, "approved");
  assert.equal(approved.request.approved_by, "staff-test");
  assert.ok(approved.request.approved_at);
  assert.equal(await count("study_room_reservations", "status = 'active'"), 2);
  assert.equal(await count("study_room_request_events"), 2);
  assert.equal(await count("study_room_notification_intents"), 1);
  assert.equal((await transition(request, "approve", { key })).replayed, true);
  assert.equal(await count("study_room_notification_intents"), 1);
});

test("competing approvals cannot both take a seat and a failed batch leaves no partial inventory", async () => {
  const first = (await submit({ slots: [slots[0], slots[1]] })).request;
  const second = (await submit({ student: "test-2", slots: [slots[1], slots[2]] })).request;
  await transition(first, "approve");
  await assert.rejects(transition(second, "approve"), /seat_unavailable/);
  assert.equal(await count("study_room_reservations", "student_number = 'test-2'"), 0);
  assert.equal(await count("study_room_requests", "status = 'pending'"), 1);
  assert.equal(await count("study_room_notification_intents"), 1);
});

test("new applications reject already full slots, including legacy inventory", async () => {
  const request = (await submit()).request;
  await transition(request, "approve");
  await assert.rejects(submit({ student: "test-2" }), /seat_unavailable/);
});

test("approval rechecks updated closures and daily limits", async () => {
  const first = (await submit()).request;
  const second = (await submit({ slots: [slots[1]] })).request;
  await db.query("insert into public.study_room_day_settings(reservation_date,closed_slot_ids,limit_minutes) values ($1,$2,90)",
    [tomorrow, JSON.stringify([slots[1]])]);
  await assert.rejects(transition(second, "approve"), /slot_closed/);
  await transition(first, "approve");
  await db.query("update public.study_room_day_settings set closed_slot_ids = '[]' where reservation_date = $1", [tomorrow]);
  await assert.rejects(transition(second, "approve"), /daily_limit_exceeded/);
  assert.equal(await count("study_room_reservations"), 1);
});

test("corrupt day settings do not silently open closed slots", async () => {
  await db.query("insert into public.study_room_day_settings(reservation_date,closed_slot_ids) values ($1,'{}')", [tomorrow]);
  await assert.rejects(submit(), /invalid_day_settings/);
});

test("student and guardian actors cannot self-approve, reject, or cancel another family", async () => {
  const { request } = await submit();
  await assert.rejects(transition(request, "approve", { kind: "guardian", actor: "guardian-line" }), /staff_permission_required/);
  await assert.rejects(transition(request, "reject", { kind: "student", actor: "student-line", reason: "test" }), /staff_permission_required/);
  await assert.rejects(transition(request, "cancel", { kind: "guardian", actor: "other-family" }), /subject_not_authorized/);
});

test("cancellation preserves records, frees all batch slots and rejects stale approvals", async () => {
  const request = (await submit({ slots: [slots[0], slots[1]] })).request;
  const approved = (await transition(request, "approve")).request;
  await assert.rejects(transition(request, "cancel"), /version_conflict/);
  const cancelled = (await transition(approved, "cancel", { kind: "guardian", actor: "guardian-line" })).request;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.approved_by, "staff-test");
  assert.equal(await count("study_room_reservations", "status = 'active'"), 0);
  assert.equal(await count("study_room_reservations", "status = 'cancelled'"), 2);
  assert.equal(await count("study_room_request_events"), 3);
  await assert.rejects(transition(cancelled, "approve"), /invalid_state_transition/);
});

test("reject requires a reason and pending cancellation makes no inventory", async () => {
  const first = (await submit()).request;
  await assert.rejects(transition(first, "reject"), /reason_required/);
  const rejected = (await transition(first, "reject", { reason: "Office reviewed the request" })).request;
  assert.equal(rejected.status, "rejected");
  const second = (await submit()).request;
  assert.equal((await transition(second, "cancel")).request.status, "cancelled");
  assert.equal(await count("study_room_reservations"), 0);
});

test("notification failure does not release an approved seat", async () => {
  await transition((await submit()).request, "approve");
  await db.exec("update public.study_room_notification_intents set status = 'failed';");
  assert.equal(await count("study_room_reservations", "status = 'active'"), 1);
  assert.equal(await count("study_room_requests", "status = 'approved'"), 1);
});

test("failure to persist the notification intent rolls back inventory, approval and event together", async () => {
  const request = (await submit()).request;
  await db.exec(`create function public.test_intent_failure() returns trigger language plpgsql as $$
    begin raise exception 'test_intent_failure'; end; $$;
    create trigger test_intent_failure before insert on public.study_room_notification_intents
    for each row execute function public.test_intent_failure();`);
  try {
    await assert.rejects(transition(request, "approve"), /test_intent_failure/);
    assert.equal(await count("study_room_reservations"), 0);
    assert.equal(await count("study_room_requests", "status = 'pending' and version = 1"), 1);
    assert.equal(await count("study_room_request_events"), 1);
  } finally {
    await db.exec("drop trigger test_intent_failure on public.study_room_notification_intents; drop function public.test_intent_failure();");
  }
});

test("native Postgres: independent sessions competing for the same seat produce exactly one approval", { skip: !nativeUrl }, async () => {
  const first = (await submit()).request;
  const second = (await submit({ student: "test-2" })).request;
  const other = await connectNative();
  try {
    const results = await Promise.allSettled([
      transition(first, "approve"), transition(second, "approve", {}, other),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.match(results.find((result) => result.status === "rejected").reason.message, /seat_unavailable/);
    assert.equal(await count("study_room_reservations", "status = 'active'"), 1);
  } finally { await other.close(); }
});

test("native Postgres: independent approvals cannot exceed a student's daily limit", { skip: !nativeUrl }, async () => {
  const first = (await submit()).request;
  const second = (await submit({ slots: [slots[1]] })).request;
  await db.query("insert into public.study_room_day_settings(reservation_date,limit_minutes) values ($1,90)", [tomorrow]);
  const other = await connectNative();
  try {
    const results = await Promise.allSettled([
      transition(first, "approve"), transition(second, "approve", {}, other),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.match(results.find((result) => result.status === "rejected").reason.message, /daily_limit_exceeded/);
    assert.equal(await count("study_room_reservations", "status = 'active'"), 1);
  } finally { await other.close(); }
});

test("browser roles cannot read sensitive requests or call mutation RPCs; audit rows are append-only for service role", async () => {
  const rows = (await db.query(`select
    has_table_privilege('anon','public.study_room_requests','SELECT') as anon_read,
    has_table_privilege('authenticated','public.study_room_requests','SELECT') as user_read,
    has_function_privilege('anon','public.study_room_submit_request(uuid,text,date,integer,text[],text,text,text)','EXECUTE') as anon_submit,
    has_function_privilege('authenticated','public.study_room_transition_request(uuid,uuid,integer,text,text,text,text)','EXECUTE') as user_transition,
    has_table_privilege('service_role','public.study_room_request_events','UPDATE') as audit_update,
    has_table_privilege('service_role','public.study_room_request_events','DELETE') as audit_delete,
    has_function_privilege('service_role','public.study_room_transition_request(uuid,uuid,integer,text,text,text,text)','EXECUTE') as server_transition
  `)).rows[0];
  assert.deepEqual(rows, { anon_read: false, user_read: false, anon_submit: false, user_transition: false,
    audit_update: false, audit_delete: false, server_transition: true });
});

test("trusted service role can execute the complete workflow with the actual granted privileges", async () => {
  await db.exec("set role service_role;");
  try {
    const { request } = await submit();
    const approved = (await transition(request, "approve")).request;
    assert.equal((await transition(approved, "cancel")).request.status, "cancelled");
  } finally { await db.exec("reset role;"); }
});

test("legacy writes cannot bypass approvals after cutover or cancel workflow inventory", async () => {
  await assert.rejects(db.query(`insert into public.study_room_reservations
    (reservation_date,slot_id,start_time,end_time,seat,student_number,grade,student_name)
    values ($1,'14:55-16:25','14:55','16:25',1,'test-1','test-grade','Test One')`, [tomorrow]), /workflow_write_required/);
  await transition((await submit()).request, "approve");
  await assert.rejects(db.exec("update public.study_room_reservations set status = 'cancelled';"), /workflow_write_required/);
  await db.exec("update public.study_room_workflow_settings set enabled = false;");
  await assert.rejects(db.exec("update public.study_room_reservations set status = 'cancelled';"), /workflow_write_required/);
  await assert.rejects(db.exec("delete from public.study_room_reservations;"), /reservation_history_must_be_preserved/);
  assert.equal(await count("study_room_reservations", "status = 'active'"), 1);
});

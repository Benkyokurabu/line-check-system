import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { buildSchedulePreview } from "../src/lib/schedule-preview.mjs";
import { authorizeScheduleSync, scheduleSyncToken, scheduleSyncMonths, scheduleSyncBlockers, syncSchedule } from "../src/lib/schedule-sync.mjs";

test("JST rollover and dedicated worker authentication", () => {
  assert.deepEqual(scheduleSyncMonths(new Date("2026-12-31T15:00:00Z")), ["2027-01", "2027-02"]);
  const key = "server-test-key";
  assert.equal(authorizeScheduleSync(new Request("https://test", { headers: { authorization: `Bearer ${scheduleSyncToken(key)}` } }), key), true);
  assert.equal(authorizeScheduleSync(new Request("https://test", { headers: { authorization: "Bearer wrong" } }), key), false);
});
test("new app refuses a legacy SQL schema before lesson DB apply", async () => {
  const calls = [];
  const db = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'schedule_sync_claim') return { data: 'run' };
    if (name === 'schedule_sync_v2_ready') return { error: { message: 'function unavailable' } };
    return { data: null };
  } };
  await assert.rejects(syncSchedule(db, '2026-09', 'key', { now: new Date('2026-09-07T10:00:00Z') }),
    e => e.message.includes('同期SQLが未適用') && e.message.includes('授業DBは変更していません'));
  assert.ok(!calls.some(x => x.name === 'schedule_sync_apply' || x.name === 'schedule_sync_apply_v2'));
  assert.equal(calls.at(-1).name, 'schedule_sync_finish');
  assert.equal(calls.at(-1).args.p_status, 'error');
});
test("missing sources, unsafe diffs and upload settling never mutate lessons", async () => {
  for (const scenario of ["missing", "remove", "ambiguous", "recent", "error"]) {
    const calls = [];
    const db = { async rpc(name, args) { calls.push({ name, args }); return { data: name === "schedule_sync_claim" ? "run" : name === "schedule_sync_v2_ready" ? true : null }; } };
    const options = { now: new Date("2026-09-07T10:00:00Z"), listMonths: async () => scenario === "missing" ? [] : [{ month: "2026-09" }],
      preview: async () => { if (scenario === "error") throw new Error("private credential detail"); return { summary: { [scenario]: 1 }, changes: [], source: { modifiedAt: scenario === "recent" ? "2026-09-07T10:00:00Z" : "2026-09-01T00:00:00Z" } }; } };
    if (scenario === "error") await assert.rejects(syncSchedule(db, "2026-09", "key", options), (e) => !e.message.includes("private"));
    else await syncSchedule(db, "2026-09", "key", options);
    assert.ok(!calls.some((c) => c.name === "schedule_sync_apply_v2"));
    assert.equal(calls.at(-1).name, "schedule_sync_finish_v2");
  }
  assert.equal(scheduleSyncBlockers({ summary: {}, changes: [{ before: { lesson_date: "2026-09-06" } }] }, new Date("2026-09-07T10:00:00Z")).length, 1);
  assert.match(scheduleSyncBlockers({ summary: {}, changes: [{ kind: "update", before: { teacher_name: "金城" }, after: { teacher_name: "金城" } }] }).join(' '), /Notion/);
  assert.match(scheduleSyncBlockers({ summary: {}, changes: [{ kind: "update", before: { teacher_name: "工藤" }, after: { teacher_name: "工藤" } }] }).join(' '), /Notion/);
});
test("teacher Notion preflight prevents DB changes, and a post-commit failure retries without reapplying lessons", async () => {
  const calls = [];
  let persisted = false;
  let status = '';
  let message = '';
  const db = { async rpc(name, args) {
    calls.push(name);
    if (name === "schedule_sync_v2_ready") return { data: true };
    if (name === "schedule_sync_claim") { status = 'running'; return { data: `run-${calls.length}` }; }
    if (name === "schedule_sync_apply_v2") {
      status = persisted ? "unchanged" : "applied";
      persisted = true;
      return { data: { status } };
    }
    if (name === "schedule_sync_finish_v2") { status = args.p_status; message = args.p_message; }
    return { data: null };
  } };
  const report = { source: { modifiedAt: "2026-09-01T00:00:00Z" },
    summary: { remove: 0, ambiguous: 0, existing: 0, update: 0 }, changes: [],
    lessons: [{ teacher_name: "工藤", campus: "本校" }, { teacher_name: "別の先生", campus: "南教室" }] };
  const options = { now: new Date("2026-09-07T10:00:00Z"), listMonths: async () => [{ month: "2026-09" }],
    preview: async () => report,
    prepareTeacherNotionSync: async () => { throw Error('Notion unavailable'); } };
  await assert.rejects(syncSchedule(db, "2026-09", "key", options));
  assert.equal(persisted, false);
  assert.ok(!calls.includes("schedule_sync_apply_v2"));

  options.prepareTeacherNotionSync = async () => ({ items: [{ teacherName: '工藤先生' }] });
  options.applyTeacherNotionSync = async () => { throw Error('private Notion detail'); };
  await assert.rejects(syncSchedule(db, "2026-09", "key", options), e =>
    e.message.includes('授業DBは反映済み') && e.message.includes('不足分を再確認') && !e.message.includes('private'));
  assert.equal(persisted, true);
  assert.equal(status, 'error');
  assert.match(message, /Notion予定は一部未完了/);
  assert.equal(calls.filter(x => x === "schedule_sync_apply_v2").length, 1);

  options.applyTeacherNotionSync = async () => ({ created: 0, existing: 1, locationPending: 0 });
  const retry = await syncSchedule(db, "2026-09", "key", options);
  assert.equal(retry.status, "unchanged");
  assert.equal(retry.teacherNotion.existing, 1);
  assert.equal(calls.filter(x => x === "schedule_sync_apply_v2").length, 2);

  options.applyTeacherNotionSync = async () => ({ created: 0, existing: 0, locationPending: 0,
    blocked: [{ date: '2026-09-17', title: '授業／４Ａ算', teacherName: '工藤先生' }] });
  const held = await syncSchedule(db, '2026-09', 'key', options);
  assert.equal(held.status, 'error');
  assert.equal(status, 'error');
  assert.match(held.message, /管理担当者が予定を確認/);
  assert.equal(persisted, true);
});
test("other teachers finish their DB import without a Notion request", async () => {
  const calls = [];
  const db = { async rpc(name, args) {
    calls.push({ name, args });
    return { data: name === 'schedule_sync_claim' ? 'run' : name === 'schedule_sync_v2_ready' ? true
      : name === 'schedule_sync_apply_v2' ? { status: 'applied' } : null };
  } };
  const report = { source: { modifiedAt: '2026-09-01T00:00:00Z' },
    summary: { remove: 0, ambiguous: 0, existing: 0, update: 0 }, changes: [],
    lessons: [{ teacher_name: '別の先生', campus: '本校' }, { teacher_name: '別の先生', campus: '南教室' }] };
  const result = await syncSchedule(db, '2026-09', 'key', {
    now: new Date('2026-09-07T10:00:00Z'), listMonths: async () => [{ month: '2026-09' }],
    preview: async () => report,
  });
  assert.equal(result.status, 'applied');
  assert.equal(calls.at(-1).name, 'schedule_sync_finish_v2');
  assert.equal(calls.at(-1).args.p_status, 'applied');
});
test("legacy SQL rejects the new app before applying lessons and still serves the old app", async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const schema = fs.readFileSync(new URL('../supabase/attendance_schema.sql', import.meta.url), 'utf8');
    await db.exec(schema.slice(0, schema.indexOf('create index')));
    const sql = fs.readFileSync(new URL('../supabase/schedule_sync.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec('update schedule_sync_control set enabled=true');
    const month = scheduleSyncMonths()[1];
    const adapter = { async rpc(name, args) {
      try {
        if (name === 'schedule_sync_claim') return { data: (await db.query('select schedule_sync_claim($1,$2) id', [args.p_month, args.p_trigger])).rows[0].id };
        if (name === 'schedule_sync_v2_ready') return { data: (await db.query('select schedule_sync_v2_ready() ready')).rows[0].ready };
        if (name === 'schedule_sync_finish') {
          await db.query('select schedule_sync_finish($1,$2,$3)', [args.p_run, args.p_status, args.p_message]);
          return { data: null };
        }
        throw Error(`Unexpected RPC ${name}`);
      } catch (error) { return { error }; }
    } };
    await assert.rejects(syncSchedule(adapter, month, 'key'), /同期SQLが未適用/);
    assert.equal((await db.query('select count(*)::int n from lessons')).rows[0].n, 0);
    assert.equal((await db.query('select status from schedule_sync_runs')).rows[0].status, 'error');

    await db.exec('update schedule_sync_control set last_started_at=null');
    const run = (await db.query("select schedule_sync_claim($1,'manual') id", [month])).rows[0].id;
    const item = { date: `${month}-07`, time: '18:00～19:30', grade: 'j1', class: 'S', subject: 'eng',
      campus: 'hon', room: '1', groupKey: 'hon_j1_S_eng', label: '中1S 英語', teacher: '別の先生' };
    const report = { ...buildSchedulePreview([item], [], month), existing: [], source: { file: 'source.xlsm', sha256: 'test' } };
    assert.equal((await db.query('select schedule_sync_apply($1,$2::jsonb) result', [run, JSON.stringify(report)])).rows[0].result.status, 'applied');
    assert.equal((await db.query('select status from schedule_sync_runs where id=$1', [run])).rows[0].status, 'applied');
    assert.equal((await db.query('select lease_until from schedule_sync_control where id=true')).rows[0].lease_until, null);
  } finally { await db.close(); }
});
test("atomic persistence keeps attendance links, rejects stale plans and restricts browser roles", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    const schema = fs.readFileSync(new URL("../supabase/attendance_schema.sql", import.meta.url), "utf8");
    await db.exec(schema.slice(0, schema.indexOf("create index")));
    await db.exec("create table attendance_link(id integer primary key,lesson_id uuid not null references lessons(id) on delete restrict)");
    await db.exec(fs.readFileSync(new URL("../supabase/schedule_sync.sql", import.meta.url), "utf8"));
    await db.exec(fs.readFileSync(new URL("../supabase/schedule_sync_v2_20261009.sql", import.meta.url), "utf8"));
    await db.exec("update schedule_sync_control set enabled=true");
    const month = scheduleSyncMonths()[1];
    const item = { date: `${month}-07`, time: "18:00～19:30", grade: "j1", class: "S", subject: "eng", campus: "hon", room: "1", groupKey: "hon_j1_S_eng", label: "中1S 英語", teacher: "講師" };
    const preview = (items, existing) => ({ ...buildSchedulePreview(items, existing, month), existing, source: { file: "source.xlsm", sha256: "test" } });
    const claim = async () => {
      await db.exec("update schedule_sync_control set last_started_at=null");
      return (await db.query("select schedule_sync_claim($1,'cron') id", [month])).rows[0].id;
    };
    const apply = (run, report) => db.query("select schedule_sync_apply_v2($1,$2::jsonb) result", [run, JSON.stringify(report)]);
    const legacyApply = (run, report) => db.query("select schedule_sync_apply($1,$2::jsonb) result", [run, JSON.stringify(report)]);
    assert.equal((await db.query("select schedule_sync_v2_ready() ready")).rows[0].ready, true);
    const first = await claim();
    assert.equal((await db.query("select schedule_sync_claim($1,'manual') id", [month])).rows[0].id, null);
    await apply(first, preview([item], []));
    const old = (await db.query("select to_jsonb(l) as lesson from lessons l")).rows[0].lesson;
    assert.equal((await claim()), null); // The lease stays held while Notion is unfinished.
    assert.equal((await db.query("select status from schedule_sync_runs where id=$1", [first])).rows[0].status, 'running');
    await db.query("select schedule_sync_finish_v2($1,'error',$2)", [first, "授業DBは反映済みですが、Notion予定は一部未完了です。次回の同期で不足分を再確認して登録します。"]);
    const failed = (await db.query("select status,message,snapshot from schedule_sync_runs where id=$1", [first])).rows[0];
    assert.equal(failed.status, "error");
    assert.match(failed.message, /不足分を再確認/);
    assert.equal(failed.snapshot.changes[0].kind, "add");
    assert.equal((await db.query("select count(*)::int n from lessons")).rows[0].n, 1);
    const retried = await claim();
    assert.equal((await apply(retried, preview([item], [old]))).rows[0].result.status, "unchanged");
    assert.equal((await db.query("select count(*)::int n from lessons")).rows[0].n, 1);
    await db.query("select schedule_sync_finish_v2($1,'unchanged','確認済み')", [retried]);
    await db.query("insert into attendance_link values(1,$1)", [old.id]);
    const second = await claim();
    const updated = { ...item, room: "2", time: "19:00～20:30" };
    await apply(second, preview([updated], [old]));
    await db.query("select schedule_sync_finish_v2($1,'applied','確認済み')", [second]);
    const actual = (await db.query("select to_jsonb(l) as lesson from lessons l")).rows[0].lesson;
    assert.equal(actual.id, old.id); assert.equal(actual.classroom, "2"); assert.equal(actual.start_time, "19:00～20:30");
    assert.equal((await db.query("select lesson_id from attendance_link")).rows[0].lesson_id, old.id);
    assert.equal((await db.query("select snapshot from schedule_sync_runs where id=$1", [second])).rows[0].snapshot.existing[0].classroom, "1");
    const third = await claim();
    await assert.rejects(apply(third, preview([item], [old])), /snapshot changed/);
    assert.equal((await db.query("select classroom from lessons")).rows[0].classroom, "2");
    // A late invalid operation rolls back an earlier valid addition in the same transaction.
    const bad = preview([updated, { ...updated, date: `${month}-08` }], [actual]);
    bad.changes.push({ kind: "remove", before: actual });
    await assert.rejects(apply(third, bad), /review required/);
    assert.equal((await db.query("select count(*)::int n from lessons")).rows[0].n, 1);
    await db.query("select schedule_sync_finish_v2($1,'error','test')", [third]);
    const fourth = await claim();
    assert.equal((await apply(fourth, preview([updated], [actual]))).rows[0].result.status, "unchanged");
    await db.exec("update schedule_sync_control set lease_until=now()-interval '1 minute',last_started_at=null");
    const resumed = (await db.query("select schedule_sync_claim($1,'cron') id", [month])).rows[0].id;
    assert.ok(resumed);
    assert.equal((await db.query("select status from schedule_sync_runs where id=$1", [fourth])).rows[0].status, 'error');
    assert.equal((await apply(resumed, preview([updated], [actual]))).rows[0].result.status, 'unchanged');
    await db.query("select schedule_sync_finish_v2($1,'unchanged','再確認済み')", [resumed]);
    assert.equal((await db.query("select count(*)::int n from lessons")).rows[0].n, 1);
    const legacy = await claim();
    assert.equal((await legacyApply(legacy, preview([updated], [actual]))).rows[0].result.status, 'unchanged');
    assert.equal((await db.query("select status from schedule_sync_runs where id=$1", [legacy])).rows[0].status, 'unchanged');
    assert.equal((await db.query("select lease_until from schedule_sync_control where id=true")).rows[0].lease_until, null);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from schedule_sync_runs"), /permission denied/);
      await assert.rejects(db.query("select schedule_sync_claim($1,'manual')", [month]), /permission denied/);
      await assert.rejects(apply(fourth, preview([updated], [actual])), /permission denied/);
      await assert.rejects(db.query("select schedule_sync_v2_ready()"), /permission denied/);
      await assert.rejects(db.query("select schedule_sync_apply_v2($1,$2::jsonb)", [resumed, JSON.stringify(preview([updated], [actual]))]), /permission denied/);
      await assert.rejects(db.query("select schedule_sync_finish_v2($1,'error','test')", [resumed]), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec('set role service_role');
    assert.equal((await db.query('select schedule_sync_v2_ready() ready')).rows[0].ready, true);
    await db.exec('reset role');
  } finally { await db.close(); }
});

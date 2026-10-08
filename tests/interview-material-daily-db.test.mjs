import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  await db.exec(await readFile(new URL('../supabase/interview_material_worker_schema.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/interview_material_daily_auto_20261007.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into interview_material_workers(id,secret_hash,priority,ready,last_seen_at)
    values('primary',repeat('a',64),1,true,now()),('standby',repeat('b',64),2,true,now());`);
  await db.exec(`update interview_material_workers set status='{"capabilities":["daily-offline-v1"]}'`);
});
after(() => db.close());
async function scan(worker = 'primary') { return (await db.query('select interview_material_daily_scan_claim($1) value', [worker])).rows[0].value; }
async function claim(worker = 'primary') { return (await db.query('select * from interview_material_claim($1)', [worker])).rows[0]; }

test('初期状態では自動作成を有効にせず、定刻より前には巡回しない', async () => {
  assert.equal(await scan(), null);
  await db.exec("insert into interview_material_jobs(kind,staff_code,payload,daily_key) values('generate','__daily_materials__','{}','stopped-protected')");
  assert.equal(await claim(), undefined);
  await db.exec("delete from interview_material_jobs where daily_key='stopped-protected'");
  await db.exec("update interview_material_daily_settings set enabled=true,run_time='23:59:59.999999',days_ahead=1");
  assert.equal(await scan(), null);
});
test('定刻に両方offでも起動後に当日の未実行分を取り、二重巡回しない', async () => {
  await db.exec("update interview_material_daily_settings set run_time='00:00';update interview_material_workers set ready=false");
  assert.equal(await scan(), null);
  await db.exec("update interview_material_workers set ready=true,last_seen_at=now() where id='primary'");
  const first = await scan();
  assert.ok(first.lease);
  assert.equal(first.date, first.runDate);
  assert.equal(await scan('standby'), null);
  const next = await scan();
  assert.notEqual(next.date, first.date);
  assert.equal(await scan(), null);
  await db.exec("update interview_material_daily_scans set status='completed',lease_until=null");
  assert.equal(await scan(), null);
});
test('主担当がoffなら予備PC1台で巡回し、失敗を5分後に再試行する', async () => {
  await db.exec("update interview_material_daily_scans set status='failed',updated_at=now()-interval '6 minutes';update interview_material_workers set ready=(id='standby'),last_seen_at=now()");
  const retry = await scan('standby');
  assert.ok(retry);
  assert.equal((await db.query('select worker_id from interview_material_daily_scans where target_date=$1', [retry.date])).rows[0].worker_id, 'standby');
  await db.exec("update interview_material_daily_scans set status='completed',lease_until=null;update interview_material_workers set ready=true,last_seen_at=now()");
});
test('手動資料作成を優先し、自動ジョブは10分待機しても処理する', async () => {
  await db.exec(`insert into interview_material_jobs(kind,staff_code,payload,daily_key,created_at)
    values('generate','__daily_materials__','{}','fixture-auto',now()-interval '20 minutes');
    insert into interview_material_jobs(kind,staff_code,payload) values('preview','fixture','{}');`);
  const first = await claim();
  assert.equal(first.kind, 'preview');
  assert.equal(await claim('standby'), undefined);
  const next = await claim();
  assert.equal(next.daily_key, 'fixture-auto');
  await assert.rejects(() => db.exec("insert into interview_material_jobs(kind,staff_code,payload,daily_key) values('generate','fixture','{}','fixture-auto')"), /unique/);
});
test('予備PCが期限切れジョブを引き継ぎ、古い主担当の完了は拒否する', async () => {
  const running = (await db.query("select * from interview_material_jobs where daily_key='fixture-auto'")).rows[0];
  await db.query("update interview_material_jobs set lease_until=now()-interval '1 minute' where id=$1", [running.id]);
  await db.exec("update interview_material_workers set ready=(id='standby'),last_seen_at=now()");
  const takeover = await claim('standby');
  assert.equal(takeover.id, running.id);
  assert.notEqual(takeover.lease_token, running.lease_token);
  const late = (await db.query("select interview_material_finish($1,'primary',$2,'completed','{}',null) ok", [running.id, running.lease_token])).rows[0];
  assert.equal(late.ok, false);
  await db.query("select interview_material_finish($1,'standby',$2,'failed',null,'fixture error')", [takeover.id, takeover.lease_token]);
  assert.equal(await claim('standby'), undefined);
  await db.query("update interview_material_jobs set completed_at=now()-interval '6 minutes' where id=$1", [takeover.id]);
  assert.equal((await claim('standby')).id, takeover.id);
});
test('匿名・一般ログインは自動設定や巡回関数へアクセスできない', async () => {
  await db.exec('set role anon');
  await assert.rejects(() => db.query('select * from interview_material_daily_settings'), /permission denied/);
  await assert.rejects(() => scan(), /permission denied/);
  await db.exec('reset role');
});
test('旧版PCは手動専用、新版予備は旧版主担当が起動中でも自動処理する', async () => {
  await db.exec(`delete from interview_material_jobs;
    update interview_material_workers set ready=true,last_seen_at=now(),status=case when id='primary' then '{}'::jsonb else '{"capabilities":["daily-offline-v1"]}'::jsonb end;
    update interview_material_daily_scans set status='failed',lease_until=null,updated_at=now()-interval '6 minutes';
    insert into interview_material_jobs(kind,staff_code,payload,daily_key,created_at)
      values('generate','__daily_materials__','{}','new-capability',now()-interval '20 minutes');
    insert into interview_material_jobs(kind,staff_code,payload) values('preview','fixture','{}');`);
  assert.equal(await scan('primary'), null);
  assert.ok(await scan('standby'));
  assert.equal((await claim('standby')).daily_key, 'new-capability');
  assert.equal((await claim('primary')).kind, 'preview');
  await db.exec("insert into interview_material_jobs(kind,staff_code,payload,daily_key) values('generate','__daily_materials__','{}','old-worker-protected')");
  assert.equal(await claim('primary'), undefined);
  assert.equal((await claim('standby')).daily_key, 'old-worker-protected');
});

test('button-triggered jobs use the online capable PC while daily scheduling stays disabled', async () => {
  await db.exec(`delete from interview_material_jobs;
    update interview_material_daily_settings set enabled=false;
    update interview_material_workers set ready=(id='standby'),last_seen_at=now();
    insert into interview_material_jobs(kind,staff_code,payload,daily_key) values
      ('generate','teacher','{"autoDaily":{"manual":true}}','manual:button'),
      ('generate','__daily_materials__','{"autoDaily":{}}','daily:stopped');`);
  assert.equal(await scan('standby'), null);
  assert.equal((await claim('standby')).daily_key, 'manual:button');
  assert.equal(await claim('standby'), undefined);
  assert.equal(await claim('primary'), undefined);
});

test('an explicit worker claims only its own job while ordinary jobs retain priority', async () => {
  await db.exec(`delete from interview_material_jobs;
    update interview_material_workers set ready=true,last_seen_at=now();
    insert into interview_material_jobs(kind,staff_code,payload) values
      ('preview','teacher','{"targetWorkerId":"standby"}'),
      ('preview','teacher','{}');`);
  const ordinary = await claim('primary');
  assert.ok(ordinary);
  assert.equal(ordinary.payload.targetWorkerId, undefined);
  const targeted = await claim('standby');
  assert.ok(targeted);
  assert.equal(targeted.payload.targetWorkerId, 'standby');
  assert.equal(await claim('primary'), undefined);
  assert.equal(await claim('standby'), undefined);

  await db.exec(`insert into interview_material_jobs(kind,staff_code,payload)
    values('generate','teacher','{"targetWorkerId":"standby"}');
    update interview_material_workers set ready=false where id='standby';`);
  assert.equal(await claim('primary'), undefined);
  assert.equal(await claim('standby'), undefined);
  await db.exec("update interview_material_workers set ready=true,last_seen_at=now() where id='standby'");
  const generated = await claim('standby');
  assert.ok(generated);
  assert.equal(generated.kind, 'generate');
  assert.equal(generated.worker_id, 'standby');
});

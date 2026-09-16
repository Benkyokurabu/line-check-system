import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('専用キーは二人だけ・失効と期限・停止・回数制限・匿名拒否をDBで検証',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,banned_until timestamptz);
   create table staff_accounts(staff_code text primary key,auth_user_id uuid,active boolean);
   create table staff_auth_settings(singleton boolean,enabled boolean);
   insert into staff_auth_settings values(true,true);
   insert into auth.users values('11111111-1111-4111-8111-111111111111','test@example.invalid',null);
   insert into staff_accounts values('KUDO','11111111-1111-4111-8111-111111111111',true),('OTHER',null,true);`);
  await db.exec(await readFile(new URL('../supabase/staff_entry_20260916.sql',import.meta.url),'utf8'));
  await db.query('insert into staff_entry_keys(staff_code,key_hash) values($1,$2)',['KUDO','a'.repeat(64)]);
  await assert.rejects(()=>db.query('insert into staff_entry_keys(staff_code,key_hash) values($1,$2)',['OTHER','b'.repeat(64)]),/check constraint/);
  const get=async hash=>(await db.query('select staff_entry_target($1) v',[hash])).rows[0].v;
  assert.equal(await get('bad'),null);
  for(let i=0;i<10;i++)assert.equal((await get('a'.repeat(64))).staffCode,'KUDO');
  assert.equal((await get('a'.repeat(64))).limited,true);
  await db.exec("update staff_entry_keys set window_start=now()-interval '2 minutes'");assert.equal((await get('a'.repeat(64))).staffCode,'KUDO');
  await db.exec('update staff_entry_keys set enabled=false');assert.equal(await get('a'.repeat(64)),null);
  await db.exec("update staff_entry_keys set enabled=true,expires_at=now()-interval '1 second'");assert.equal(await get('a'.repeat(64)),null);
  await db.exec("update staff_entry_keys set expires_at=now()+interval '1 day';update staff_accounts set active=false");assert.equal(await get('a'.repeat(64)),null);
  await db.exec('set role anon');await assert.rejects(()=>get('a'.repeat(64)),/permission denied/);await assert.rejects(()=>db.query('select * from staff_entry_keys'),/permission denied/);
 }finally{await db.close();}
});

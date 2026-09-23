import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {surveyPageId,validateSurveyChanges} from '../src/lib/survey-confirmations.mjs';
import './survey-scheduling.test.mjs';
test('URL表記を同じ回答IDに統一し、不正な保存を拒否する',()=>{
 assert.equal(surveyPageId('https://app.notion.com/p/11111111-1111-4111-8111-111111111111'),'11111111111141118111111111111111');
 assert.equal(surveyPageId('bad'),null);
 assert.throws(()=>validateSurveyChanges([{pageId:'a'.repeat(32),confirmed:true,version:-1}]));
 assert.throws(()=>validateSurveyChanges([{pageId:'a'.repeat(32),confirmed:true,version:0},{pageId:'a'.repeat(32),confirmed:false,version:0}]));
});
test('確認状態共有・変更取消・再送・別回答の同時更新・競合時の全件ロールバック・権限',async()=>{
 const db=new PGlite();const staff='11111111-1111-4111-8111-111111111111',a='a'.repeat(32),b='b'.repeat(32);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,active boolean);insert into staff_accounts values('${staff}',true);`);
  await db.exec(fs.readFileSync(new URL('../supabase/survey_confirmations_20260916.sql',import.meta.url),'utf8'));
  const save=changes=>db.query('select save_survey_confirmations($1,$2)',[staff,JSON.stringify(changes)]);
  const get=async id=>(await db.query('select * from survey_confirmations where page_id=$1',[id])).rows[0];
  await save([{pageId:a,confirmed:true,version:0}]);assert.equal((await get(a)).version,1);
  await save([{pageId:a,confirmed:true,version:0}]);assert.equal((await get(a)).version,1);
  await save([{pageId:b,confirmed:true,version:0}]);assert.equal((await get(a)).confirmed,true);
  await save([{pageId:a,confirmed:false,version:1}]);assert.equal((await get(a)).version,2);
  await assert.rejects(()=>save([{pageId:b,confirmed:false,version:1},{pageId:a,confirmed:true,version:1}]),/survey_conflict/);
  assert.equal((await get(b)).confirmed,true);assert.equal((await get(a)).confirmed,false);
  await db.exec('update staff_accounts set active=false');await assert.rejects(()=>save([{pageId:a,confirmed:true,version:2}]),/staff_permission_denied/);
  await db.exec('set role anon');await assert.rejects(()=>get(a),/permission denied/);await assert.rejects(()=>save([{pageId:a,confirmed:true,version:2}]),/permission denied/);
 }finally{await db.close();}
});

test('ログインなしの共有操作は先生を偽装せず、旧状態・競合・再送・直接アクセス拒否を保つ',async()=>{
 const db=new PGlite();const staff='11111111-1111-4111-8111-111111111111',a='a'.repeat(32),b='b'.repeat(32);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,active boolean);insert into staff_accounts values('${staff}',true);`);
  await db.exec(fs.readFileSync(new URL('../supabase/survey_confirmations_20260916.sql',import.meta.url),'utf8'));
  await db.query('select save_survey_confirmations($1,$2)',[staff,JSON.stringify([{pageId:a,confirmed:true,version:0}])]);
  await db.exec(fs.readFileSync(new URL('../supabase/survey_shared_operations_20260923.sql',import.meta.url),'utf8'));
  const get=async id=>(await db.query('select * from survey_confirmations where page_id=$1',[id])).rows[0];
  assert.equal((await get(a)).updated_by,staff);
  const save=changes=>db.query('select save_shared_survey_confirmations($1)',[JSON.stringify(changes)]);
  await save([{pageId:a,confirmed:false,version:1}]);assert.equal((await get(a)).updated_by,null);assert.equal((await get(a)).version,2);
  await save([{pageId:a,confirmed:false,version:1}]);assert.equal((await get(a)).version,2);
  await assert.rejects(()=>save([{pageId:b,confirmed:true,version:0},{pageId:a,confirmed:true,version:1}]),/survey_conflict/);assert.equal(await get(b),undefined);
  await assert.rejects(()=>save([{pageId:b,confirmed:true}]),/invalid_request/);await assert.rejects(()=>save(null),/invalid_request/);
  await db.exec('set role anon');await assert.rejects(()=>save([{pageId:b,confirmed:true,version:0}]),/permission denied/);
  await db.exec('reset role;set role service_role');await save([{pageId:b,confirmed:true,version:0}]);await db.exec('reset role');assert.equal((await get(b)).updated_by,null);
 }finally{await db.close();}
});

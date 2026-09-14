import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {changeInterviewTrial,readInterviewTrial,interviewTrialSlots,trialDay} from '../src/lib/interview-trial.mjs';
const today='2026-09-14';const kudo={staffId:'kudo',staffCode:'KUDO',displayName:'工藤',role:'admin'},kinjo={staffId:'kinjo',staffCode:'KINJO',displayName:'金城',role:'admin'};
const slot=(offset=3,start='13:00',campus='本校')=>interviewTrialSlots(today).find(s=>s.date===trialDay(offset,today)&&s.start===start&&s.campus===campus);
const submit=(choices=[slot().id])=>({action:'submit',operationKey:randomUUID(),choices,purpose:'学習相談',participants:'本人、母',method:'対面',note:''});
function fixture(){let state={rows:[],operations:[],events:[]};return {get state(){return state;},run(actor,view,input,day=today){const result=changeInterviewTrial(state,actor,view,input,day);state=result.state;return result.result.request;}};}
const action=(name,row,extra={})=>({action:name,operationKey:randomUUID(),id:row.id,version:row.version,...extra});
test('本人は自分の希望だけ確認でき、URL・入力値による別人申請を受け付けない',()=>{
 const f=fixture();f.run(kudo,'student',{...submit(),studentCode:'KINJO'});
 assert.equal(readInterviewTrial(f.state,kudo,'student',today).requests[0].studentCode,'KUDO');assert.equal(readInterviewTrial(f.state,kinjo,'student',today).requests.length,0);
 assert.throws(()=>f.run({...kudo,staffCode:'OTHER'},'student',submit()),e=>e.status===403);
 const row=f.state.rows[0];assert.throws(()=>f.run(kinjo,'student',action('cancel',row,{reason:'別人'})),e=>e.status===403);
 assert.throws(()=>f.run(kudo,'student',action('approve',row,{slotId:slot().id})),e=>e.status===403);
});
test('最大3希望を承認して他の希望を解放、柔軟時間帯は1件だけ確定',()=>{
 const f=fixture(),a=f.run(kudo,'student',submit([slot(3,'18:35').id,slot(3,'20:30').id]));
 const b=f.run(kinjo,'student',submit([slot(3,'19:20').id]));
 f.run(kudo,'staff',action('approve',a,{slotId:slot(3,'18:35').id}));
 assert.throws(()=>f.run(kinjo,'staff',action('approve',b,{slotId:slot(3,'19:20').id})),e=>e.status===409);
 const shown=readInterviewTrial(f.state,kinjo,'student',today).slots;assert.equal(shown.find(s=>s.id===slot(3,'20:30').id).available,true);assert.equal(shown.find(s=>s.id===slot(3,'19:20').id).available,false);
});
test('変更・取消の申請中は旧予約を維持し、承認された時だけ解放する',()=>{
 const f=fixture();let a=f.run(kudo,'student',submit());a=f.run(kinjo,'staff',action('approve',a,{slotId:slot().id}));
 a=f.run(kudo,'student',{...submit([slot(4).id]),...action('change',a)});assert.equal(a.confirmed.id,slot().id);
 assert.equal(readInterviewTrial(f.state,kinjo,'student',today).slots.find(s=>s.id===slot().id).available,false);
 a=f.run(kinjo,'staff',action('approve',a,{slotId:slot(4).id}));assert.equal(a.confirmed.id,slot(4).id);
 a=f.run(kudo,'student',action('cancel',a,{reason:'都合変更'}));assert.equal(a.status,'cancel_requested');
 assert.equal(readInterviewTrial(f.state,kinjo,'student',today).slots.find(s=>s.id===slot(4).id).available,false);
 a=f.run(kinjo,'staff',action('approve_cancel',a,{reason:'本人希望'}));assert.equal(a.status,'cancelled');
 assert.equal(readInterviewTrial(f.state,kinjo,'student',today).slots.find(s=>s.id===slot(4).id).available,true);
});
test('変更申請の見送り・撤回は元の確定を保持し、古い版での操作を拒否',()=>{
 const f=fixture();let a=f.run(kudo,'student',submit());a=f.run(kinjo,'staff',action('approve',a,{slotId:slot().id}));
 a=f.run(kudo,'student',{...submit([slot(4).id]),...action('change',a)});const old=a;
 a=f.run(kinjo,'staff',action('reject',a,{reason:'日程調整'}));assert.equal(a.status,'approved');assert.equal(a.confirmed.id,slot().id);
 assert.throws(()=>f.run(kudo,'student',action('withdraw',old)),e=>e.status===409);
 a=f.run(kudo,'student',action('cancel',a,{reason:'確認'}));a=f.run(kudo,'student',action('withdraw',a));assert.equal(a.status,'approved');
});
test('2日前の受付期限、重複希望、校舎混在、操作の重複と別人再試行を検証',()=>{
 const f=fixture(),input=submit();const a=f.run(kudo,'student',input),b=f.run(kudo,'student',input);assert.equal(a.id,b.id);assert.equal(f.state.rows.length,1);
 assert.throws(()=>f.run(kinjo,'student',input),e=>e.status===409);
 assert.throws(()=>f.run(kudo,'student',submit([slot(1).id])),/2日前/);
 assert.throws(()=>f.run(kudo,'student',submit([slot().id,slot().id])),/最大3件/);
 assert.throws(()=>f.run(kudo,'student',submit([slot().id,slot(4,'13:00','南教室').id])),/同じ校舎/);
 assert.doesNotThrow(()=>f.run(kudo,'student',submit([slot(2).id])));
});
test('確認用DBは実予約から独立、匿名アクセスを拒否し、版の競合で上書きしない',async()=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../supabase/interview_trial_20260914.sql',import.meta.url),'utf8'));
  await db.exec('set role anon');await assert.rejects(()=>db.query('select * from staff_interview_trial_state'),/permission denied/);await db.exec('reset role;set role service_role');
  const first=await db.query("update staff_interview_trial_state set version=2 where id='main' and version=1 returning version");assert.equal(first.rows.length,1);
  const second=await db.query("update staff_interview_trial_state set version=2 where id='main' and version=1 returning version");assert.equal(second.rows.length,0);
 }finally{await db.close();}
});

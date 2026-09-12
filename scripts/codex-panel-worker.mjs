import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { CodexRPC } from './codex-panel-runtime.mjs';
import { buildCodexPrompt } from '../src/lib/codex-panel-core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
process.loadEnvFile(path.join(root,'.env.local'));
const cwd=path.join(root,'.worktrees','codex-panel');
const check=process.argv.includes('--check');
const rpc=new CodexRPC(check ? root : cwd);
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})}});
const workerId=randomUUID();
let running=null, stopped=false, disconnected=false, heartbeatTimer=null, heartbeatBusy=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function db(query) {const {data,error}=await query;if(error) throw new Error('Queue database unavailable');return data;}
async function update(id,patch) {
  const ok=await db(client.rpc('bentan_codex_update',{p_worker_id:workerId,p_id:id,p_patch:patch}));
  if(!ok) throw new Error('Queue lease lost');
}
function safeText(value) {
  return String(value ?? '').replace(/\b(?:sk-|sb_secret_)[A-Za-z0-9_-]+/g,'[非表示]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[非表示]').slice(0,60000);
}
rpc.on('disconnected',()=>{disconnected=true;});
process.on('SIGTERM',()=>{stopped=true;rpc.close();});
process.on('SIGINT',()=>{stopped=true;rpc.close();});
rpc.on('message',event=>{
  const state=running;
  if (!state) {if(event.id!==undefined) rpc.send({id:event.id,error:{code:-32601,message:'No active request'}});return;}
  const p=event.params || {};
  if (p.threadId && state.threadId && p.threadId!==state.threadId) return;
  if (event.id!==undefined) {
    if (['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(event.method)) {
      // Server requests can be concurrent. Present them one at a time; never auto-approve.
      state.approvals.push({rpcId:event.id,id:randomUUID(),message:safeText(
        `Codexが操作の許可を求めています。\n${p.reason || ''}\n${p.command || (event.method.includes('fileChange') ? 'ファイル変更の許可' : '')}`)});
    } else rpc.send({id:event.id,error:{code:-32601,message:'This UI does not support this request. Ask the user in an assistant message.'}});
    return;
  }
  if(event.method==='turn/started') state.turnId=p.turn?.id;
  if(event.method==='item/agentMessage/delta') {
    const id=p.itemId || 'message';state.messages.set(id,(state.messages.get(id)||'')+(p.delta||''));state.dirty=true;
  }
  if(event.method==='item/completed' && p.item?.type==='agentMessage') {state.messages.set(p.item.id,p.item.text||'');state.dirty=true;}
  if(event.method==='item/started') {
    const descriptions={commandExecution:'コマンドを実行・検証しています',fileChange:'コードを修正しています',webSearch:'情報を確認しています',agentMessage:'回答しています'};
    state.progress=descriptions[p.item?.type] || 'Codexが作業しています';state.dirty=true;
  }
  if(event.method==='turn/completed') {state.finished=p.turn?.status || 'failed';state.dirty=true;}
});
async function begin(job) {
  running={job,threadId:null,turnId:null,messages:new Map(),approvals:[],shownApproval:null,dirty:false,finished:null,startedAt:Date.now(),interrupted:false,progress:'Codexが依頼を確認しています'};
  const conversation=await db(client.from('bentan_codex_conversations').select('codex_thread_id').eq('id',job.conversation_id).single());
  const options={cwd,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write'};
  const result=await rpc.call(conversation.codex_thread_id?'thread/resume':'thread/start',{
    ...options,...(conversation.codex_thread_id?{threadId:conversation.codex_thread_id}:{}),
  });
  running.threadId=result.thread.id;
  await db(client.from('bentan_codex_conversations').update({codex_thread_id:result.thread.id}).eq('id',job.conversation_id));
  const started=await rpc.call('turn/start',{threadId:result.thread.id,input:[{type:'text',text:buildCodexPrompt(job)}]});
  running.turnId=started.turn.id;
}
async function service() {
  const state=running;if(!state) return;
  const row=await db(client.from('bentan_codex_requests').select('status,cancel_requested,approval_decision').eq('id',state.job.id).single());
  if (!['running','awaiting_approval'].includes(row.status)) throw new Error('Queue lease lost');
  if(row.cancel_requested && !state.interrupted && state.turnId) {
    await rpc.call('turn/interrupt',{threadId:state.threadId,turnId:state.turnId});state.interrupted=true;
    state.progress='停止を依頼しました。すでに行われた変更は自動では戻りません。';state.dirty=true;
  }
  if(state.shownApproval && row.approval_decision) {
    rpc.send({id:state.shownApproval.rpcId,result:{decision:row.approval_decision}});
    state.approvals.shift();state.shownApproval=null;
    await update(state.job.id,{status:'running',approval:null,approval_decision:null});
  }
  if(!state.shownApproval && state.approvals.length && !state.interrupted && !state.finished) {
    state.shownApproval=state.approvals[0];
    await update(state.job.id,{status:'awaiting_approval',approval:{id:state.shownApproval.id,message:state.shownApproval.message},approval_decision:null});
  }
  if(state.interrupted && state.approvals.length) {
    for(const approval of state.approvals) rpc.send({id:approval.rpcId,result:{decision:'decline'}});
    state.approvals=[];state.shownApproval=null;
  }
  if(state.dirty || state.finished) {
    await update(state.job.id,{response:safeText([...state.messages.values()].join('\n\n')),progress:state.progress});state.dirty=false;
  }
  if(state.finished) {
    const status=state.finished==='completed'?'completed':state.finished==='interrupted'?'cancelled':'failed';
    await update(state.job.id,{status,approval:null,approval_decision:null,progress:status==='completed'?'回答しました。反映状況は回答本文を確認してください。':status==='cancelled'?'作業を停止しました。実施済みの変更は残ります。':'Codexの処理が終了できませんでした。変更状況を確認して再依頼してください。'});
    running=null;
  }
  if(Date.now()-state.startedAt>6*60*60*1000) throw new Error('Maximum execution time exceeded');
}
try {
  const account=await rpc.initialize();
  if(check) {console.log(JSON.stringify({...account,protocol:'stdio',ready:true}));}
  else {
    if(!fs.existsSync(path.join(cwd,'.git'))) throw new Error('Dedicated worktree missing');
    console.log('Bentan Codex worker started (private queue, no listening ports).');
    const heartbeat=async()=>{
      if(heartbeatBusy) return;
      heartbeatBusy=true;
      try {
        const leased=await db(client.rpc('bentan_codex_tick',{p_worker_id:workerId,p_ready:true}));
        if(!leased) throw new Error('Another worker owns the lease');
      } catch {stopped=true;rpc.close();}
      finally {heartbeatBusy=false;}
    };
    await heartbeat();
    heartbeatTimer=setInterval(()=>void heartbeat(),8000);
    while(!stopped && !disconnected) {
      if(!running) {
        const job=await db(client.rpc('bentan_codex_claim',{p_worker_id:workerId}));
        if(job) await begin(job);
      }
      await service();
      await delay(2000);
    }
  }
} catch(error) {
  console.error(error.message==='ChatGPT login required'?'CodexでChatGPTへのログインが必要です。':'Codex接続処理が停止しました。接続と専用作業フォルダを確認してください。');
  process.exitCode=1;
} finally {
  if(heartbeatTimer) clearInterval(heartbeatTimer);
  rpc.close();
  if(running) await update(running.job.id,{status:'failed',approval:null,progress:'PCとの接続が終了しました。変更状況を確認して再依頼してください。'}).catch(()=>{});
  if(!check) await client.from('bentan_codex_worker').update({ready:false}).eq('worker_id',workerId);
}

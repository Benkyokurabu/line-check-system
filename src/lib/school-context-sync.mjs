import {notionRecord,lineRecord,proposalForRecord,importedLineRecord,contextDigest} from './school-context-core.mjs';

export function contextDatabase(result){if(result.error)throw new Error('school_context_database_unavailable');return result.data;}
export async function saveContextRecord(db,record){return contextDatabase(await db.rpc('school_context_ingest',{p_record:record,p_proposal:proposalForRecord(record)}));}
export async function saveContextRecords(db,records){if(records.length)return contextDatabase(await db.rpc('school_context_ingest_batch',{p_records:records.map(record=>({record,proposal:proposalForRecord(record)}))}));return 0;}
export async function recordCoverage(db,channel,scope,status,detail){contextDatabase(await db.from('school_context_coverage').insert({channel,scope,status,detail}));}
async function readState(db,key){return contextDatabase(await db.from('school_context_state').select('value').eq('key',key).maybeSingle())?.value??{};}
async function writeState(db,key,value){contextDatabase(await db.from('school_context_state').upsert({key,value,updated_at:new Date().toISOString()}));}
const safeFailure=error=>({code:typeof error?.code==='string'&&/^[a-z_]+$/.test(error.code)?error.code:'request_failed',httpStatus:Number(error?.status)||null});
const deadlineError=()=>Object.assign(new Error('context_work_deadline'),{code:'context_work_deadline'});
// Supabase builders start the HTTP request when awaited. Bound that request at
// the execution point, including RPCs, without changing query ordering or SQL.
export function deadlineContextDatabase(db,deadlineAt){
  const wrap=target=>new Proxy(target,{get(object,key){
    if(key==='then'&&typeof object.then==='function')return(resolve,reject)=>{
      const remaining=deadlineAt-Date.now();
      if(remaining<=0)return Promise.reject(deadlineError()).then(resolve,reject);
      const query=typeof object.abortSignal==='function'?object.abortSignal(AbortSignal.timeout(Math.max(1,remaining))):object;
      return query.then(resolve,reject);
    };
    const value=Reflect.get(object,key,object);
    return typeof value==='function'?(...args)=>{const next=value.apply(object,args);return next&&typeof next==='object'?wrap(next):next;}:value;
  }});
  return {from:(...args)=>wrap(db.from(...args)),rpc:(...args)=>wrap(db.rpc(...args))};
}
export async function associateContextStudents(db,record){
  const ids=[...new Set([record.nativeId,...record.associations.filter(a=>a.kind==='notion_relation').map(a=>a.id)])].filter(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if(!ids.length)return record;
  const registry=contextDatabase(await db.from('student_registry').select('student_number,notion_page_id,enrollment_status').in('notion_page_id',ids));
  const additions=(registry??[]).map(student=>({kind:'student_number',id:student.student_number,verifiedStudent:true,reason:{table:'student_registry',notionPageId:student.notion_page_id,enrollmentStatus:student.enrollment_status,sourcePageId:record.nativeId,relationProperties:record.associations.filter(a=>a.kind==='notion_relation'&&a.id.toLowerCase()===student.notion_page_id.toLowerCase()).map(a=>a.reason.property),match:'exact_notion_page_id'}}));
  const associations=[...record.associations,...additions];
  return {...record,associations,version:contextDigest({sourceVersion:record.version,associations})};
}

export function notionContextRequest({token,version='2025-09-03',request=fetch,deadlineAt=Infinity}){
  let lastCall=0;
  return async(path,body)=>{
    const delay=Math.max(0,350-(Date.now()-lastCall));if(Date.now()+delay>=deadlineAt)throw deadlineError();
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));lastCall=Date.now();
    const remaining=deadlineAt-Date.now();if(remaining<=0)throw deadlineError();
    const response=await request(`https://api.notion.com/v1${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Notion-Version':version},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.max(1,Math.min(8000,remaining))),cache:'no-store'});
    if(!response.ok){const error=new Error('notion_request_failed');error.status=response.status;error.code=[401,403,404].includes(response.status)?'permission_or_source_unavailable':response.status===429?'rate_limited':'request_failed';throw error;}
    const result=await response.json();if(!result||typeof result!=='object')throw new Error('invalid_notion_response');return result;
  };
}

/** One resumable batch; no Notion or LINE writes and no external messages. */
export async function syncSchoolContext(options){
  const hardDeadline=Date.now()+50000,db=deadlineContextDatabase(options.db,hardDeadline);
  const lease=contextDatabase(await db.rpc('school_context_sync_claim'));
  if(!lease)return {busy:true,canContinue:true};
  try{return await syncContextBatch({...options,db,hardDeadline});}
  finally{contextDatabase(await deadlineContextDatabase(options.db,Date.now()+5000).rpc('school_context_sync_release',{p_lease:lease}));}
}
async function syncContextBatch({db,notion=null,token=null,deadlineMs=40000,blockBudget=12,lineLimit=500,hardDeadline=Date.now()+50000}){
  const started=Date.now(),deadline=Math.min(started+Math.max(0,deadlineMs),hardDeadline-10000),requestDeadline=deadline-3000,report={notion:{discovered:0,completed:0,partial:0,failed:0},line:{imported:0,hasMore:false},errors:[]};
  const request=notion??(token?notionContextRequest({token,deadlineAt:requestDeadline}):null);
  if(!request){await recordCoverage(db,'notion','connection_discovery','unavailable',{reason:'notion_token_missing',complete:false});report.errors.push('notion_token_missing');}
  else if(Date.now()>=requestDeadline){await recordCoverage(db,'notion','connection_discovery','partial',{reason:'notion_budget_exhausted',complete:false,cursorRetained:true});}
  else{
    const state=await readState(db,'notion_discovery');
    try{
      const cycleAt=state.cursor?state.cycleStartedAt:new Date().toISOString();
      const page=await request('/search',{filter:{value:'page',property:'object'},sort:{direction:'descending',timestamp:'last_edited_time'},page_size:100,...(state.cursor?{start_cursor:state.cursor}:{})});
      if(!Array.isArray(page.results)||typeof page.has_more!=='boolean'||page.has_more&&!page.next_cursor)throw new Error('invalid_notion_discovery_response');
      const objects=[...new Map(page.results.filter(p=>p.object==='page').map(object=>[object.id,object])).values()];
      const keys=objects.map(object=>`notion:${object.id}`);
      const priorRows=keys.length?contextDatabase(await db.from('school_context_sources').select('*').in('source_key',keys)):[];
      const bySource=new Map((priorRows??[]).map(prior=>[prior.source_key,prior]));
      const discovered=objects.map(object=>{
        const sourceKey=`notion:${object.id}`;
        const prior=bySource.get(sourceKey);
        const changed=!prior||prior.metadata?.page?.last_edited_time!==object.last_edited_time;
        const due=prior&&Date.now()-Date.parse(prior.metadata?.lastFullFetch??'1970-01-01')>86400000;
        const metadata={...prior?.metadata,page:object,discoveryCycleAt:cycleAt,...(changed?{progress:null}:{})};
        return {source_key:sourceKey,source_type:'notion',native_id:object.id,metadata,pending:!!(changed||due||prior?.pending||prior?.status==='unavailable'),status:changed&&prior?.last_version?'needs_refresh':prior?.status??'discovered',updated_at:prior?.updated_at??new Date().toISOString()};
      });
      if(discovered.length)contextDatabase(await db.from('school_context_sources').upsert(discovered));
      const truncated=!!page.request_status?.incomplete_reason;
      if(!page.has_more&&!truncated)contextDatabase(await db.rpc('school_context_discovery_finish',{p_cycle:cycleAt}));
      await writeState(db,'notion_discovery',{cursor:page.has_more?page.next_cursor:null,cycleStartedAt:cycleAt,lastCompletedAt:page.has_more||truncated?state.lastCompletedAt:new Date().toISOString()});
      report.notion.discovered=objects.length;
      await recordCoverage(db,'notion','connection_discovery',page.has_more||truncated?'partial':'complete_for_connection',{complete:!page.has_more&&!truncated,cursor:page.next_cursor??null,discovered:objects.length,workspaceComplete:false,...(truncated?{apiIncompleteReason:page.request_status.incomplete_reason}:{}),limitations:['接続へ共有され、Notion検索APIが返すページの範囲です。塾内全体の閲覧権限・検索漏れは保証しません。']});
    }catch(error){report.errors.push('notion_discovery_failed');await recordCoverage(db,'notion','connection_discovery','failed',{complete:false,...safeFailure(error),cursorRetained:state.cursor??null});}
    let budget=blockBudget;
    while(budget>0&&Date.now()<requestDeadline){
      const source=contextDatabase(await db.from('school_context_sources').select('*').eq('source_type','notion').eq('pending',true).order('updated_at').limit(1).maybeSingle());
      if(!source)break;
      const metadata=source.metadata??{};
      let page=metadata.page,progress=metadata.progress??{queue:[{id:source.native_id,cursor:null}],blocks:[],version:page?.last_edited_time??null};
      try{
        if(!page){page=await request(`/pages/${source.native_id}`);budget--;progress.version=page.last_edited_time??null;}
        const node=progress.queue[0];
        if(node&&budget>0){
          const result=await request(`/blocks/${node.id}/children?page_size=100${node.cursor?`&start_cursor=${encodeURIComponent(node.cursor)}`:''}`);budget--;
          if(!Array.isArray(result.results)||typeof result.has_more!=='boolean'||result.has_more&&!result.next_cursor)throw new Error('invalid_notion_blocks_response');
          progress={...progress,blocks:[...progress.blocks,...result.results],queue:[...(result.has_more?[{id:node.id,cursor:result.next_cursor}]:[]),...progress.queue.slice(1),...result.results.filter(b=>b.has_children).map(b=>({id:b.id,cursor:null}))]};
        }
        let complete=progress.queue.length===0;
        if(complete&&budget>0&&Date.now()<requestDeadline){
          const latest=await request(`/pages/${source.native_id}`);budget--;
          if(latest.last_edited_time!==page.last_edited_time){
            contextDatabase(await db.from('school_context_sources').update({metadata:{...metadata,page:latest,progress:null},pending:true,updated_at:new Date().toISOString()}).eq('source_key',source.source_key));
            await recordCoverage(db,'notion',source.source_key,'changed_during_fetch',{complete:false,reason:'source_edited_during_fetch'});continue;
          }
          page=latest;
        }else if(complete)complete=false;
        const propertyPartial=Object.values(page.properties??{}).some(property=>property.has_more===true);
        const limitations=[...(complete?['コメント・添付ファイル内容・権限外ページは対象外']:['本文の階層・ページングまたは原本版の照合を継続取得中']),...(propertyPartial?['プロパティの一部はNotion応答で省略されています']:[])];
        const record=await associateContextStudents(db,notionRecord(page,progress.blocks,{complete:complete&&!propertyPartial,limitations}));
        await saveContextRecord(db,record);
        contextDatabase(await db.from('school_context_sources').update({metadata:{...metadata,page,progress:complete?null:progress,...(complete?{lastFullFetch:new Date().toISOString()}:{})},pending:!complete,updated_at:new Date().toISOString()}).eq('source_key',source.source_key));
        await recordCoverage(db,'notion',source.source_key,complete?'complete_for_page':'partial',{complete,version:record.version,remainingBlockLists:progress.queue.length,limitations:record.coverage.limitations});
        report.notion[complete?'completed':'partial']++;
      }catch(error){
        if(error?.code==='context_work_deadline'||Date.now()>=requestDeadline){
          await recordCoverage(db,'notion',source.source_key,'partial',{complete:false,reason:'notion_budget_exhausted',retainedPreviousVersion:true});break;
        }
        report.notion.failed++;report.errors.push('notion_page_failed');
        contextDatabase(await db.from('school_context_sources').update({status:'unavailable',updated_at:new Date().toISOString()}).eq('source_key',source.source_key));
        await recordCoverage(db,'notion',source.source_key,'failed',{complete:false,...safeFailure(error),retainedPreviousVersion:true});break;
      }
    }
  }
  try{
    const state=await readState(db,'line_messages_cursor');
    let query=db.from('line_messages').select('*').order('created_at').order('id').limit(lineLimit);
    if(state.createdAt&&state.id)query=query.or(`created_at.gt.${state.createdAt},and(created_at.eq.${state.createdAt},id.gt.${state.id})`);
    const rows=contextDatabase(await query)??[];
    const ids=[...new Set(rows.map(r=>r.line_user_id))];
    const links=ids.length?contextDatabase(await db.from('student_line_accounts').select('student_number,line_user_id,verification_status').in('line_user_id',ids)):[];
    await saveContextRecords(db,rows.map(row=>lineRecord(row,links)));
    const hasMore=rows.length===lineLimit,last=rows.at(-1);report.line={imported:rows.length,hasMore};
    await writeState(db,'line_messages_cursor',hasMore&&last?{createdAt:last.created_at,id:last.id}:{});
    await recordCoverage(db,'line','line_messages',hasMore?'partial':'complete_for_stored_rows',{complete:!hasMore,count:rows.length,directions:['inbound','outbound'],cursor:hasMore?{createdAt:last.created_at,id:last.id}:null,limitations:['既存DBに保存された記録のみ。LINE管理画面の直接返信・履歴ファイルの未取込分は未確認。未返信を断定できません。','画像・音声・添付の意味理解は対象外。']});
  }catch(error){report.errors.push('line_import_failed');await recordCoverage(db,'line','line_messages','failed',{complete:false,...safeFailure(error)});}
  return {...report,elapsedMs:Date.now()-started,canContinue:true};
}

export async function importContextLineEvents(db,events,coverage=[]){
  if(!Array.isArray(events)||events.length>100000)throw new Error('invalid_line_event_list');
  // Validate every event before starting persistence.
  const records=events.map(event=>importedLineRecord(event));
  for(let offset=0;offset<records.length;offset+=100)await saveContextRecords(db,records.slice(offset,offset+100));
  for(const item of coverage)await recordCoverage(db,'line',`import:${item.account??'unknown'}:${item.scope??'unknown'}`,'partial',{...item,complete:false});
  await recordCoverage(db,'line','line_history_import','partial',{complete:false,count:records.length,limitations:['ファイル範囲外は未確認。未返信と断定しません。']});
  return {imported:records.length};
}

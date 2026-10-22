import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {syncSchoolContext,importContextLineEvents,associateContextStudents} from '../src/lib/school-context-sync.mjs';

// Supabase query transport backed by a real isolated PostgreSQL engine.
function adapter(sql){
 const ident=value=>{assert.match(value,/^[a-z_]+$/);return value;};
 return {
  async rpc(name,args={}){try{return {data:(await sql.query(`select ${ident(name)}(${Object.values(args).map((_,i)=>`$${i+1}`).join(',')}) value`,Object.values(args))).rows[0].value,error:null};}catch(error){return {data:null,error};}},
  from(table){
   ident(table);const state={mode:'select',columns:'*',filters:[],orders:[],limit:null,single:false,rows:null};
   const api={
    select(columns='*'){state.columns=columns;return api;},eq(column,value){state.filters.push({kind:'eq',column:ident(column),value});return api;},
    in(column,value){state.filters.push({kind:'in',column:ident(column),value});return api;},
    order(column){state.orders.push(ident(column));return api;},limit(value){state.limit=value;return api;},maybeSingle(){state.single=true;return api;},
    insert(rows){state.mode='insert';state.rows=Array.isArray(rows)?rows:[rows];return api;},
    upsert(rows){state.mode='upsert';state.rows=Array.isArray(rows)?rows:[rows];return api;},
    update(row){state.mode='update';state.rows=[row];return api;},
    or(value){state.filters.push({kind:'cursor',value});return api;},
    async then(resolve,reject){try{
     const values=[],param=value=>{values.push(value);return `$${values.length}`;};
     const where=()=>state.filters.length?' where '+state.filters.map(filter=>filter.kind==='eq'?`${filter.column}=${param(filter.value)}`:filter.kind==='in'?`${filter.column}=any(${param(filter.value)})`:(()=>{const parts=filter.value.match(/^created_at.gt.(.+),and\(created_at.eq.(.+),id.gt.(.+)\)$/);assert.ok(parts);return `(created_at>${param(parts[1])} or (created_at=${param(parts[2])} and id>${param(parts[3])}))`;})()).join(' and '):'';
     let query;
     if(state.mode==='select')query=`select ${state.columns==='*'?'*':state.columns.split(',').map(ident).join(',')} from ${table}${where()}${state.orders.length?' order by '+state.orders.join(','):''}${state.limit?' limit '+Number(state.limit):''}`;
     else if(state.mode==='update')query=`update ${table} set ${Object.entries(state.rows[0]).map(([key,value])=>`${ident(key)}=${param(value)}`).join(',')}${where()}`;
     else{
      const keys=Object.keys(state.rows[0]);query=`insert into ${table}(${keys.map(ident).join(',')}) values ${state.rows.map(row=>'('+keys.map(key=>param(row[key])).join(',')+')').join(',')}`;
      if(state.mode==='upsert'){const pk=table==='school_context_sources'?'source_key':'key';query+=` on conflict(${pk}) do update set ${keys.filter(key=>key!==pk).map(key=>`${ident(key)}=excluded.${ident(key)}`).join(',')}`;}
     }
     const result=await sql.query(query,values);resolve({data:state.single?result.rows[0]??null:result.rows,error:null});
    }catch(error){if(resolve)resolve({data:null,error});else reject(error);}}
   };return api;
  }
 };
}
async function isolated(){const sql=new PGlite();await sql.exec(`create role anon;create role authenticated;create role service_role;create table staff_accounts(id uuid primary key,staff_code text,role text,active boolean);create function staff_authorize(uuid,uuid)returns jsonb language sql as $$select '{}'::jsonb$$;create table line_messages(id uuid primary key,line_user_id text,text text,direction text,created_at timestamptz);create table student_line_accounts(student_number text,line_user_id text,verification_status text);`);await sql.exec(await readFile(new URL('../supabase/school_context_20261022.sql',import.meta.url),'utf8'));return sql;}
const page={object:'page',id:'test-page',last_edited_time:'2026-10-22T00:00:00Z',properties:{title:{type:'title',title:[{plain_text:'面談記録'}]}}};

test('実DBへ初回同期、本文階層とNotion/LINE継続cursor、lease排他を検証',async()=>{
 const sql=await isolated();try{
  await sql.exec("insert into line_messages values('11111111-1111-4111-8111-111111111111','U1','面談相談','inbound','2026-10-22'),('22222222-2222-4222-8222-222222222222','U1','返信しました','outbound','2026-10-22');insert into student_line_accounts values('123','U1','confirmed');");
  const db=adapter(sql),searches=[];let searchCount=0;
  const notion=async(path,body)=>{
   if(path==='/search'){searches.push(body);searchCount++;return {results:searchCount===1?[page]:[],has_more:searchCount===1,next_cursor:searchCount===1?'page-two':null};}
   if(path==='/pages/test-page')return page;
   if(path.startsWith('/blocks/test-page/children'))return {results:[{id:'nested',type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'確認してください'}]}}],has_more:false};
   if(path.startsWith('/blocks/nested/children'))return {results:[{id:'child',type:'paragraph',paragraph:{rich_text:[{plain_text:'生徒への対応を相談'}]}}],has_more:false};
   throw new Error('unexpected_request');
  };
  const first=await syncSchoolContext({db,notion,blockBudget:1,lineLimit:1});assert.equal(first.notion.partial,1);assert.equal(first.line.imported,1);assert.equal(first.line.hasMore,true);
  const second=await syncSchoolContext({db,notion,blockBudget:5,lineLimit:1});assert.equal(second.notion.completed,1);assert.equal(second.line.imported,1);assert.equal(searches[1].start_cursor,'page-two');
  const third=await syncSchoolContext({db,notion,blockBudget:1,lineLimit:1});assert.equal(third.line.imported,0);assert.equal(third.line.hasMore,false);
  const latest=(await sql.query("select r.* from school_context_records r join school_context_sources s on s.source_key=r.source_key and s.last_version=r.version where r.source_type='notion'")).rows[0];assert.match(latest.content,/生徒への対応を相談/);assert.equal(latest.coverage.complete,true);
  assert.equal((await sql.query('select count(*)::int n from school_context_records where source_type=\'line\'')).rows[0].n,2);
  const lease=(await sql.query('select school_context_sync_claim() lease')).rows[0].lease;assert.deepEqual(await syncSchoolContext({db,notion}),{busy:true,canContinue:true});
  assert.equal((await sql.query('select school_context_sync_release($1) ok',['33333333-3333-4333-8333-333333333333'])).rows[0].ok,false);await sql.query('select school_context_sync_release($1)',[lease]);
 }finally{await sql.close();}
});

test('権限不足と取得失敗を0件扱いせずcoverageへ残し、ファイルcoverageだけでも保存',async()=>{
 const sql=await isolated();try{
  const db=adapter(sql),error=Object.assign(new Error('do not echo provider payload'),{status:403,code:'permission_or_source_unavailable'});
  const result=await syncSchoolContext({db,notion:async()=>{throw error;}});assert.ok(result.errors.includes('notion_discovery_failed'));
  const failed=(await sql.query("select * from school_context_coverage where channel='notion'")).rows[0];assert.equal(failed.status,'failed');assert.equal(failed.detail.complete,false);assert.equal(failed.detail.httpStatus,403);assert.equal(JSON.stringify(failed).includes('provider payload'),false);
  await importContextLineEvents(db,[],[{account:'school',scope:'chat_list',complete:true,rows:2229,outboundCoverage:'unknown'}]);
  const imported=(await sql.query("select detail from school_context_coverage where scope='import:school:chat_list'")).rows[0].detail;assert.equal(imported.complete,false);assert.equal(imported.rows,2229);
  assert.equal((await sql.query("select count(*)::int n from school_context_records")).rows[0].n,0);
 }finally{await sql.close();}
});

test('Notion relationと生徒DBの正確なID対応を根拠付きでLINEと同じ生徒番号へ結び付ける',async()=>{
 const sql=await isolated();try{
  await sql.exec("create table student_registry(student_number text,notion_page_id uuid,enrollment_status text);insert into student_registry values('123','11111111-1111-4111-8111-111111111111','current_roster');");
  const original={nativeId:'22222222-2222-4222-8222-222222222222',version:'raw',associations:[{kind:'notion_relation',id:'11111111-1111-4111-8111-111111111111',reason:{property:'生徒'}}]};
  const record=await associateContextStudents(adapter(sql),original);assert.equal(record.associations.length,2);assert.equal(record.associations[1].id,'123');assert.equal(record.associations[1].verifiedStudent,true);assert.deepEqual(record.associations[1].reason.relationProperties,['生徒']);assert.notEqual(record.version,'raw');
 }finally{await sql.close();}
});

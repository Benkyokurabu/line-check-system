// Prepare computed November availability labels; this does not edit background-color rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const mode=process.argv[2]||'help';
if(mode==='help'){
  console.log('Usage: prepare-timeband-colors.mjs inspect|prepare|verify. Background rules remain a separate Notion view setting.');
  process.exit(0);
}
assert.ok(['inspect','prepare','verify'].includes(mode));
const source='19ef0120-80a7-80c4-a965-000b104ea319';
const property='個別空き時間帯';
const previousExpression='if(empty(prop("日時")), "", if(and(contains(prop("内容"), "個別使用可能"), formatDate(dateStart(prop("日時")), "YYYY-MM") == "2026-11"), formatDate(dateStart(prop("日時")), "HH:mm"), ""))';
// Unix arithmetic keeps JST stable even when API formula evaluation uses UTC.
const from=Date.parse('2026-11-01T00:00:00+09:00');
const to=Date.parse('2026-12-01T00:00:00+09:00');
const minutes='mod(floor(timestamp(dateStart(prop("日時"))) / 60000) + 540, 1440)';
const expression=`if(empty(prop("日時")), "", if(and(contains(prop("内容"), "個別使用可能"), and(timestamp(dateStart(prop("日時"))) >= ${from}, timestamp(dateStart(prop("日時"))) < ${to})), ifs(${minutes} == 1005, "16:45", ${minutes} == 1115, "18:35", ${minutes} == 1225, "20:25", true, ""), ""))`;
const env={};
if(fs.existsSync('.env.local'))for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([^#=]+)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim().replace(/^["']|["']$/g,'');
}
const tokenFile=path.join(os.homedir(),'.codex','notion_token.txt');
const token=process.env.NOTION_TOKEN||process.env.NOTION_API_KEY||env.NOTION_TOKEN||env.NOTION_API_KEY||(fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():'');
if(!token)throw new Error('Notion connection unavailable');
const dir='.private/kobetsu-20261021';fs.mkdirSync(dir,{recursive:true});
async function request(endpoint,method='GET',body){
  const response=await fetch(`https://api.notion.com/v1/${endpoint}`,{method,headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2026-03-11','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok)throw new Error(`Notion ${response.status}: ${result.message}`);return result;
}
async function query(filter){
  const pages=[];let cursor;
  do{
    const result=await request(`data_sources/${source}/query`,'POST',{page_size:100,start_cursor:cursor,filter});
    pages.push(...result.results);cursor=result.has_more?result.next_cursor:undefined;
    if(pages.length>10000)throw new Error('Too many pages');
  }while(cursor);
  return pages;
}
const before=await request(`data_sources/${source}`);
const viewsBefore=[];
for(const id of ['39ef0120-80a7-803b-8303-000c4a846891','39ef0120-80a7-8006-b5e6-000cb24d9b5f'])viewsBefore.push(await request(`views/${id}`));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
if(mode==='inspect'){
  console.log(JSON.stringify({property,existing:before.properties[property]??null,expression,background_rules_changed:false},null,2));
  process.exit(0);
}
if(mode==='prepare'){
  fs.writeFileSync(`${dir}/timeband-source-before-${stamp}.json`,JSON.stringify(before,null,2),{flag:'wx'});
  fs.writeFileSync(`${dir}/timeband-views-before-${stamp}.json`,JSON.stringify(viewsBefore,null,2),{flag:'wx'});
  if(before.properties[property]){
    assert.equal(before.properties[property].type,'formula','Existing property has a different purpose');
    const current=before.properties[property].formula.expression;
    assert.ok(current===expression||current===previousExpression,'Do not overwrite an unrelated existing formula');
    if(current===previousExpression)await request(`data_sources/${source}`,'PATCH',{properties:{[property]:{formula:{expression}}}});
  }else{
    await request(`data_sources/${source}`,'PATCH',{properties:{[property]:{formula:{expression}}}});
  }
}
const after=await request(`data_sources/${source}`);
assert.equal(after.properties[property]?.type,'formula','Time-band property not available');
assert.equal(after.properties[property].formula.expression,expression,'Formula differs from the verified JST expression');
for(const [name,value]of Object.entries(before.properties))if(name!==property)assert.deepEqual(after.properties[name],value,`Existing property changed: ${name}`);
for(const view of viewsBefore){
  const current=await request(`views/${view.id}`);
  for(const field of ['filter','sorts','quick_filters','configuration'])assert.deepEqual(current[field],view[field],`Existing view ${field} changed`);
}
const pages=await query({and:[{property:'日時',date:{on_or_after:'2026-10-01T00:00:00+09:00'}},{property:'日時',date:{before:'2026-12-01T00:00:00+09:00'}}]});
const counts={};let confirmed=0,october=0;
const snapshots=[];
for(const page of pages){
  const p=page.properties,date=p['日時'].date?.start;
  const tags=p['内容'].multi_select.map(t=>t.name);
  const day=date?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date)):'';
  const time=date?.includes('T')?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date)):'';
  const expected=day.startsWith('2026-11')&&tags.includes('個別使用可能')&&['16:45','18:35','20:25'].includes(time)?time:'';
  const value=p[property]?.formula;
  assert.equal(value?.type,'string',`Unexpected formula output on ${page.id}`);
  assert.equal(value.string??'',expected,`Unexpected time band on ${page.id}`);
  if(expected)counts[expected]=(counts[expected]??0)+1;
  if(day.startsWith('2026-10'))october++;
  if(tags.includes('個別指導')&&!tags.includes('個別使用可能'))confirmed++;
  snapshots.push({id:page.id,edited:page.last_edited_time,date,tags,timeband:value.string??''});
}
fs.writeFileSync(`${dir}/timeband-pages-${stamp}.json`,JSON.stringify(snapshots,null,2),{flag:'wx'});
const report={verified_at:new Date().toISOString(),property,property_id:after.properties[property].id,formula:after.properties[property].formula.expression,verified_pages:pages.length,november_available_by_start:counts,october_blank_verified:october,confirmed_blank_verified:confirmed,background_rules_changed:false,background_colors_applied:false,existing_schema_and_view_settings_preserved:true};
fs.writeFileSync(`${dir}/timeband-preparation.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

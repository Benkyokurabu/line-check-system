// Update only the calendar views embedded in the existing individual-class page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const databaseId = '39ef0120-80a7-8040-a7a0-e3605c8c640b';
const expectedSource = '19ef0120-80a7-80c4-a965-000b104ea319';
const mode = process.argv[2] || 'help';
if (mode === 'help') {
  console.log('Usage: node scripts/individual-room-availability/sort-calendar.mjs inspect|apply');
  process.exit(0);
}
assert.ok(['inspect', 'apply'].includes(mode), 'Use inspect or apply');
const env = {};
if (fs.existsSync('.env.local')) for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g,'');
}
const tokenFile = path.join(os.homedir(), '.codex', 'notion_token.txt');
const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || env.NOTION_TOKEN || env.NOTION_API_KEY || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile,'utf8').trim() : '');
if (!token) throw new Error('Notion connection unavailable');
const output = '.private/kobetsu-20261021';
fs.mkdirSync(output, {recursive:true});
async function request(endpoint, method = 'GET', body) {
  const response = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method, headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2026-03-11','Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Notion ${response.status}: ${result.message}`);
  return result;
}
const refs=[];let cursor;
do {
  const params=new URLSearchParams({database_id:databaseId,page_size:'100'});
  if(cursor)params.set('start_cursor',cursor);
  const result=await request(`views?${params}`);
  refs.push(...result.results);cursor=result.has_more?result.next_cursor:undefined;
}while(cursor);
const views=[];
for(const ref of refs)views.push(await request(`views/${ref.id}`));
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
fs.writeFileSync(`${output}/calendar-views-before-${stamp}.json`,JSON.stringify(views,null,2),{flag:'wx'});
if(mode==='inspect'){
  console.log(JSON.stringify({database_id:databaseId,views},null,2));
  process.exit(0);
}
const calendars=views.filter(v=>v.type==='calendar');
assert.ok(calendars.length,'No calendar views found');
for(const view of calendars){
  if(view.data_source_id)assert.equal(view.data_source_id,expectedSource,'Unexpected data source');
  if(view.parent?.database_id)assert.equal(view.parent.database_id,databaseId,'Unexpected database');
}
const expected=[{property:'日時',direction:'ascending'},{property:'教室',direction:'ascending'}];
const schema=await request(`data_sources/${expectedSource}`);
const roomOptions=schema.properties['教室'].select.options.map(x=>x.name).filter(n=>/^本[①-⑦]$/.test(n));
assert.deepEqual(roomOptions,['本①','本②','本③','本④','本⑤','本⑥','本⑦'],'Room option ordering needs review');
const expectedIds=expected.map(s=>({property:decodeURIComponent(schema.properties[s.property].id),direction:s.direction}));
const results=[];
for(const view of calendars){
  const current=await request(`views/${view.id}`);
  for(const field of ['filter','quick_filters','configuration','sorts'])assert.deepEqual(current[field],view[field],`View ${field} changed before update`);
  await request(`views/${view.id}`,'PATCH',{sorts:expected});
  const after=await request(`views/${view.id}`);
  fs.writeFileSync(`${output}/calendar-view-after-${view.id}.json`,JSON.stringify(after,null,2));
  assert.deepEqual(after.filter,view.filter,'View filter changed');
  assert.equal(after.type,view.type,'View layout changed');
  assert.deepEqual(after.quick_filters,view.quick_filters,'Quick filters changed');
  assert.deepEqual(after.configuration,view.configuration,'View configuration changed');
  assert.deepEqual(after.sorts?.map(s=>({...s,property:decodeURIComponent(s.property)})),expectedIds,'Sort verification failed');
  results.push({id:after.id,name:after.name,type:after.type,sorts:after.sorts});
}
fs.writeFileSync(`${output}/calendar-sort-result.json`,JSON.stringify({at:new Date().toISOString(),database_id:databaseId,results},null,2));
console.log(JSON.stringify({database_id:databaseId,results},null,2));

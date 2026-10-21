// Explicitly requested November text-color trial; never writes appointment pages.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const mode=process.argv[2]||'help';
if(mode==='help'){
  console.log('Usage: apply-timeband-text.mjs inspect|apply|verify. Apply displays styled times and empties the old background-color helper.');
  process.exit(0);
}
assert.ok(['inspect','apply','verify'].includes(mode));
const source='19ef0120-80a7-80c4-a965-000b104ea319';
const viewId='39ef0120-80a7-803b-8303-000c4a846891';
const weekId='39ef0120-80a7-8006-b5e6-000cb24d9b5f';
const property='個別表示時刻',backgroundProperty='個別空き時間帯';
const from=Date.parse('2026-11-01T00:00:00+09:00'),to=Date.parse('2026-12-01T00:00:00+09:00');
const minutes='mod(floor(timestamp(dateStart(prop("日時"))) / 60000) + 540, 1440)';
const oldExpression=`if(empty(prop("日時")), "", if(and(contains(prop("内容"), "個別使用可能"), and(timestamp(dateStart(prop("日時"))) >= ${from}, timestamp(dateStart(prop("日時"))) < ${to})), ifs(${minutes} == 1005, "16:45", ${minutes} == 1115, "18:35", ${minutes} == 1225, "20:25", true, ""), ""))`;
const disabled='""';
const expression=`if(empty(prop("日時")), "", lets(t, timestamp(dateStart(prop("日時"))), m, ${minutes}, label, ifs(m == 1005, "16:45", m == 1115, "18:35", m == 1225, "20:25", true, ""), if(and(and(t >= ${from}, t < ${to}), and(contains(prop("校舎"), "本校"), contains(prop("内容"), "個別指導"))), if(contains(prop("内容"), "個別使用可能"), ifs(label == "16:45", style(label, "blue"), label == "18:35", style(label, "purple"), label == "20:25", style(label, "gray"), true, ""), unstyle(label)), "")))`;
const env={};
if(fs.existsSync('.env.local'))for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([^#=]+)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim().replace(/^["']|["']$/g,'');
}
const tokenFile=path.join(os.homedir(),'.codex','notion_token.txt');
const token=process.env.NOTION_TOKEN||process.env.NOTION_API_KEY||env.NOTION_TOKEN||env.NOTION_API_KEY||(fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():'');
if(!token)throw new Error('Notion connection unavailable');
const dir='.private/kobetsu-20261021';fs.mkdirSync(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
function save(name,data){fs.writeFileSync(`${dir}/text-time-${name}-${stamp}.json`,JSON.stringify(data,null,2),{flag:'wx'});}
async function request(endpoint,method='GET',body){
  const response=await fetch(`https://api.notion.com/v1/${endpoint}`,{method,headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2026-03-11','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok)throw new Error(`Notion ${response.status}: ${result.message}`);return result;
}
async function query(){
  const pages=[];let cursor;
  do{
    const result=await request(`data_sources/${source}/query`,'POST',{page_size:100,start_cursor:cursor,filter:{and:[{property:'日時',date:{on_or_after:'2026-10-01T00:00:00+09:00'}},{property:'日時',date:{before:'2026-12-01T00:00:00+09:00'}}]}});
    pages.push(...result.results);cursor=result.has_more?result.next_cursor:undefined;
    assert.ok(pages.length<10000,'Unexpected query scope');
  }while(cursor);
  return pages;
}
function expected(page){
  const p=page.properties,date=p['日時'].date?.start;
  if(!date?.includes('T'))return '';
  const t=Date.parse(date),m=((Math.floor(t/60000)+540)%1440+1440)%1440;
  const label={1005:'16:45',1115:'18:35',1225:'20:25'}[m]??'';
  return t>=from&&t<to&&p['校舎'].multi_select.some(x=>x.name==='本校')&&p['内容'].multi_select.some(x=>x.name==='個別指導')?label:'';
}
function appointments(pages){return new Map(pages.map(p=>[p.id,{properties:Object.fromEntries(['名前','日時','内容','校舎','教室','担当者'].map(n=>[n,p.properties[n]])),icon:p.icon}]));}
const before=await request(`data_sources/${source}`);
const viewBefore=await request(`views/${viewId}`),weekBefore=await request(`views/${weekId}`);
assert.equal(viewBefore.name,'本校個別のみ');assert.equal(viewBefore.type,'calendar');assert.equal(viewBefore.data_source_id,source);
assert.ok(before.properties[backgroundProperty]?.type==='formula','Background helper missing or changed');
assert.ok([oldExpression,disabled].includes(before.properties[backgroundProperty].formula.expression),'Do not overwrite an unrelated background helper');
if(before.properties[property])assert.equal(before.properties[property].formula?.expression,expression,'Do not overwrite an unrelated display formula');
if(mode==='inspect'){
  console.log(JSON.stringify({property,existing:before.properties[property]??null,background_helper_disabled:before.properties[backgroundProperty].formula.expression===disabled,view:viewBefore.name,expression},null,2));process.exit(0);
}
let beforePages;
if(mode==='apply'){
  beforePages=await query();
  save('source-before',before);save('views-before',[viewBefore,weekBefore]);save('pages-before',beforePages);
  if(!before.properties[property])await request(`data_sources/${source}`,'PATCH',{properties:{[property]:{formula:{expression}}}});
}
let after=await request(`data_sources/${source}`);
assert.equal(after.properties[property]?.formula?.expression,expression,'Display formula was not saved');
const pages=await query(),counts={};let confirmed=0,outside=0;
for(const page of pages){
  const value=page.properties[property]?.formula;
  assert.equal(value?.type,'string');
  assert.equal(value.string??'',expected(page),`Unexpected display text for ${page.id}: ${JSON.stringify(value)}`);
  const label=expected(page);
  if(label){
    if(page.properties['内容'].multi_select.some(x=>x.name==='個別使用可能'))counts[label]=(counts[label]??0)+1;
    else confirmed++;
  }else outside++;
}
save('pages-verified',pages);
if(mode==='apply'){
  assert.deepEqual(appointments(pages),appointments(beforePages),'Appointment data changed during preparation; stop before changing presentation');
  const current=await request(`views/${viewId}`);
  for(const key of ['filter','sorts','quick_filters','configuration'])assert.deepEqual(current[key],viewBefore[key],`View ${key} changed during preparation`);
  const id=decodeURIComponent(after.properties[property].id);
  const props=current.configuration.properties.filter(p=>decodeURIComponent(p.property_id)!==id).map(p=>Object.fromEntries(Object.entries(p).filter(([key])=>key!=='property_name')));
  props.splice(props.findIndex(p=>p.property_id==='title')+1,0,{property_id:id,visible:true});
  await request(`views/${viewId}`,'PATCH',{configuration:{type:'calendar',date_property_id:current.configuration.date_property_id,properties:props}});
  // No deletion of rules: their old 3 time values no longer match this helper.
  const currentSource=await request(`data_sources/${source}`);
  assert.ok([oldExpression,disabled].includes(currentSource.properties[backgroundProperty].formula.expression),'Background helper changed concurrently');
  if(currentSource.properties[backgroundProperty].formula.expression!==disabled)await request(`data_sources/${source}`,'PATCH',{properties:{[backgroundProperty]:{formula:{expression:disabled}}}});
}
after=await request(`data_sources/${source}`);
assert.equal(after.properties[backgroundProperty].formula.expression,disabled,'Old background helper still active');
assert.equal(after.properties[property].formula.expression,expression);
for(const [name,p]of Object.entries(before.properties))if(![property,backgroundProperty].includes(name))assert.deepEqual(after.properties[name],p,`Unrelated schema changed: ${name}`);
const viewAfter=await request(`views/${viewId}`),weekAfter=await request(`views/${weekId}`);
for(const key of ['filter','sorts','quick_filters','name','type'])assert.deepEqual(viewAfter[key],viewBefore[key],`View ${key} changed`);
for(const [key,value]of Object.entries(viewBefore.configuration))if(key!=='properties')assert.deepEqual(viewAfter.configuration[key],value,`Calendar ${key} changed`);
const id=decodeURIComponent(after.properties[property].id);
assert.ok(viewAfter.configuration.properties.some(p=>decodeURIComponent(p.property_id)===id&&p.visible),'Display property not visible');
// Notion may expand omitted schema properties into explicit visible:false entries.
const previousProps=viewBefore.configuration.properties.filter(p=>decodeURIComponent(p.property_id)!==id);
const existingIds=new Set(previousProps.map(p=>p.property_id));
assert.deepEqual(viewAfter.configuration.properties.filter(p=>existingIds.has(p.property_id)),previousProps,'Existing property display settings changed');
for(const p of viewAfter.configuration.properties)if(decodeURIComponent(p.property_id)!==id&&!existingIds.has(p.property_id))assert.equal(p.visible,false,'An unrelated property became visible');
for(const key of ['filter','sorts','quick_filters','configuration'])assert.deepEqual(weekAfter[key],weekBefore[key],`Weekly view ${key} changed`);
const finalPages=await query();
for(const p of finalPages){assert.equal(p.properties[backgroundProperty]?.formula?.string??'','');assert.equal(p.properties[property]?.formula?.string??'',expected(p));}
if(beforePages)assert.deepEqual(appointments(finalPages),appointments(beforePages),'Appointment data changed during presentation update');
save('source-after',after);save('views-after',[viewAfter,weekAfter]);
const report={verified_at:new Date().toISOString(),property,property_id:after.properties[property].id,available_by_time:counts,confirmed_unstyled_verified:confirmed,outside_scope_blank_verified:outside,pages_checked:pages.length,old_background_helper_disabled:true,conditional_rules_edited:false,appointment_pages_written:0,calendar_property_visible:true,visual_verification:false,existing_green_rule_changed:false};
fs.writeFileSync(`${dir}/text-time-result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

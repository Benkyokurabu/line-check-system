// Read-only verification of the sort settings and the 158 cards created in this run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

if (!process.argv.includes('--verify')) {
  console.log('Use --verify from the repository root to read and verify this run.');
  process.exit(0);
}
const dir='.private/kobetsu-20261021';
const ids=new Set(fs.readFileSync(`${dir}/created-pages.jsonl`,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).id));
assert.equal(ids.size,158,'Unexpected operation log');
const env={};
for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([^#=]+)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim().replace(/^["']|["']$/g,'');
}
const file=path.join(os.homedir(),'.codex','notion_token.txt');
const token=process.env.NOTION_TOKEN||process.env.NOTION_API_KEY||env.NOTION_TOKEN||env.NOTION_API_KEY||(fs.existsSync(file)?fs.readFileSync(file,'utf8').trim():'');
if(!token)throw new Error('Notion connection unavailable');
async function request(endpoint,body){
  const response=await fetch(`https://api.notion.com/v1/${endpoint}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2026-03-11','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok)throw new Error(`Notion ${response.status}: ${result.message}`);return result;
}
const source='19ef0120-80a7-80c4-a965-000b104ea319';
const schema=await request(`data_sources/${source}`);
const expected=[{property:decodeURIComponent(schema.properties['日時'].id),direction:'ascending'},{property:decodeURIComponent(schema.properties['教室'].id),direction:'ascending'}];
const views=[];
for(const id of ['39ef0120-80a7-803b-8303-000c4a846891','39ef0120-80a7-8006-b5e6-000cb24d9b5f']){
  const view=await request(`views/${id}`);
  assert.deepEqual(view.sorts.map(s=>({...s,property:decodeURIComponent(s.property)})),expected,'Calendar sort changed');
  views.push({name:view.name,sorts:[{property:'日時',direction:'ascending'},{property:'教室',direction:'ascending'}]});
}
const pages=[];let cursor;
do{
  const result=await request(`data_sources/${source}/query`,{page_size:100,start_cursor:cursor,filter:{and:[{property:'日時',date:{on_or_after:'2026-10-21T00:00:00+09:00'}},{property:'日時',date:{before:'2026-12-01T00:00:00+09:00'}},{property:'校舎',multi_select:{contains:'本校'}},{property:'内容',multi_select:{contains:'個別指導'}}]},sorts:[{property:'日時',direction:'ascending'},{property:'教室',direction:'ascending'}]});
  pages.push(...result.results);cursor=result.has_more?result.next_cursor:undefined;
}while(cursor);
const rows=pages.filter(p=>ids.has(p.id)).map(p=>({id:p.id,date:p.properties['日時'].date.start,room:p.properties['教室'].select.name}));
assert.equal(rows.length,158,'Some created cards were not found');
const roomNumber=s=>s.match(/[①-⑦]/u)[0].charCodeAt(0)-'①'.charCodeAt(0)+1;
for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i];
  assert.ok(Date.parse(a.date)<Date.parse(b.date)||Date.parse(a.date)===Date.parse(b.date)&&roomNumber(a.room)<=roomNumber(b.room),'Created cards are not in chronological/classroom order');
}
const sample=rows.filter(r=>r.date.startsWith('2026-11-02')).map(r=>({time:r.date.slice(11,16),room:r.room}));
const report={verified_at:new Date().toISOString(),verified_created_cards:rows.length,views,sample_november_2:sample};
fs.writeFileSync(`${dir}/added-sort-verification.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

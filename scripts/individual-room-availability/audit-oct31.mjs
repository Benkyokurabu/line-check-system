// Historical manual implementation, not an application feature.
// Reading local evidence is allowed; network replay requires an explicit CLI flag.
if (!process.argv.includes('--replay-read-only')) {
  console.log('Saved 2026-10-21 manual implementation. See docs/individual-room-availability-20261021.md. Use --replay-read-only only to inspect authorized local/Notion evidence.');
  process.exit(0);
}
if (process.argv.includes('apply')) throw new Error('This run already completed. Publishing is disabled in the archived implementation.');
process.argv = process.argv.filter(value => value !== '--replay-read-only');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir='.private/kobetsu-20261021';
const env={};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^\s*([^#=]+)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim().replace(/^["']|["']$/g,'');}
const token=env.NOTION_TOKEN||env.NOTION_API_KEY||fs.readFileSync(path.join(os.homedir(),'.codex','notion_token.txt'),'utf8').trim();
const source='19ef0120-80a7-80c4-a965-000b104ea319';
const pages=[];let cursor;
do{
 const response=await fetch(`https://api.notion.com/v1/data_sources/${source}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:JSON.stringify({page_size:100,start_cursor:cursor,filter:{and:[{property:'日時',date:{on_or_after:'2026-10-29T00:00:00+09:00'}},{property:'日時',date:{before:'2026-11-01T00:00:00+09:00'}}]},sorts:[{property:'日時',direction:'ascending'}]})});
 const result=await response.json();if(!response.ok)throw Error(`Notion ${response.status}: ${result.message}`);pages.push(...result.results);cursor=result.has_more?result.next_cursor:undefined;
}while(cursor);
fs.writeFileSync(`${dir}/audit-oct29-31-current.json`,JSON.stringify(pages,null,2));
const created=new Set(fs.readFileSync(`${dir}/created-pages.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s).id));
const before=JSON.parse(fs.readFileSync(`${dir}/notion-pages.json`,'utf8'));
const result=pages.filter(p=>p.properties['内容']?.multi_select.some(t=>t.name==='個別使用可能')).map(p=>({id:p.id,url:p.url,created_at:p.created_time,edited:p.last_edited_time,name:p.properties['名前'].title.map(t=>t.plain_text??t.text?.content??'').join(''),date:p.properties['日時'].date,room:p.properties['教室'].select?.name??'',tags:p.properties['内容'].multi_select.map(t=>t.name),campuses:p.properties['校舎'].multi_select.map(t=>t.name),teachers:p.properties['担当者'].relation.map(t=>t.id),created_this_operation:created.has(p.id),existed_before:before.some(b=>b.id===p.id)}));
console.log(JSON.stringify(result,null,2));

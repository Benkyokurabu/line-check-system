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
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const dir = '.private/kobetsu-20261021';
const sourceId = '19ef0120-80a7-80c4-a965-000b104ea319';
const mode = process.argv[2] || 'snapshot';
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const tokenPath = path.join(os.homedir(), '.codex', 'notion_token.txt');
const token = env.NOTION_TOKEN || env.NOTION_API_KEY || (fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '');
if (!token) throw new Error('Notion token missing');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequest = 0;
async function request(endpoint, method = 'GET', body) {
  await wait(Math.max(0, 360 - (Date.now() - lastRequest)));
  lastRequest = Date.now();
  const response = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2025-09-03' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Notion ${response.status}: ${result.message}`);
  return result;
}
async function query(filter) {
  const pages = [];
  let cursor;
  do {
    const result = await request(`data_sources/${sourceId}/query`, 'POST', {
      page_size: 100, start_cursor: cursor, filter, sorts: [{ property: '日時', direction: 'ascending' }],
    });
    pages.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
    if (pages.length > 15000) throw new Error('Query bound exceeded');
  } while (cursor);
  return pages;
}
function simplify(page) {
  const p = page.properties;
  return { id: page.id, url: page.url, edited: page.last_edited_time,
    title: p['名前']?.title.map(x => x.plain_text ?? x.text?.content ?? '').join('') ?? '',
    date: p['日時']?.date, tags: p['内容']?.multi_select.map(x => x.name) ?? [],
    room: p['教室']?.select?.name ?? '', campus: p['校舎']?.multi_select.map(x => x.name) ?? [],
    teachers: p['担当者']?.relation.map(x => x.id) ?? [],
    note: p['備考']?.rich_text.map(x => x.plain_text ?? x.text?.content ?? '').join('') ?? '',
  };
}
async function readAllRelevant() {
  const recent = await query({ and: [
    { property: '日時', date: { on_or_after: '2026-10-01T00:00:00+09:00' } },
    { property: '日時', date: { before: '2026-12-01T00:00:00+09:00' } },
  ] });
  // Include earlier events so a multi-day booking/closure cannot disappear at the month boundary.
  const earlier = await query({ and: [
    { property: '日時', date: { before: '2026-10-01T00:00:00+09:00' } },
    { or: [
      ...['本①', '本②', '本③', '本④', '本⑥'].map(name => ({ property: '教室', select: { equals: name } })),
      { property: '校舎', multi_select: { contains: '本校' } },
    ] },
  ] });
  return [...new Map([...recent, ...earlier].map(p => [p.id, p])).values()];
}
const snapshotHash = rows => crypto.createHash('sha256').update(JSON.stringify(rows.map(x => [x.id, x.edited]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
if (mode === 'style') {
  const pages=JSON.parse(fs.readFileSync(`${dir}/notion-pages.json`,'utf8')).filter(p=>p.properties['内容']?.multi_select.some(t=>t.name==='個別使用可能')&&p.properties['日時']?.date?.start?.startsWith('2026-10'));
  const icons={};for(const p of pages){const key=JSON.stringify(p.icon??null);icons[key]=(icons[key]??0)+1;}
  console.log(JSON.stringify({icons,covers:[...new Set(pages.map(p=>JSON.stringify(p.cover??null)))]}));process.exit(0);
}
if (mode === 'snapshot') {
  const schema = await request(`data_sources/${sourceId}`);
  for (const name of ['名前','日時','教室','校舎','内容','担当者']) assert.ok(schema.properties[name], `Missing ${name}`);
  const pages = await readAllRelevant();
  const rows = pages.map(simplify);
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(`${dir}/notion-pages-before-${stamp}.json`, JSON.stringify(pages, null, 2), {flag:'wx'});
  fs.writeFileSync(`${dir}/notion-pages.json`, JSON.stringify(pages, null, 2));
  fs.writeFileSync(`${dir}/notion-rows.json`, JSON.stringify(rows, null, 2));
  fs.writeFileSync(`${dir}/snapshot-meta.json`, JSON.stringify({at:new Date().toISOString(),hash:snapshotHash(rows)},null,2));
  const template = pages.find(p => p.properties['内容']?.multi_select.some(t => t.name==='個別使用可能'));
  console.log(JSON.stringify({mode,rows:rows.length,earlier:rows.filter(r=>r.date?.start<'2026-10-01').length,templateIcon:template?.icon??null,connection:(await request('users/me')).name}));
  process.exit(0);
}

const plans = ['2026-10','2026-11'].map(month => JSON.parse(fs.readFileSync(`${dir}/plan-${month}.json`,'utf8')));
const allowedRooms = ['本①','本②','本③','本④','本⑥'];
const candidates = plans.flatMap(p=>p.candidates);
for (const p of plans) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p.source)).digest('hex'),p.source_sha256,'Staged source changed');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`${dir}/cloud-${p.month}.xlsm`)).digest('hex'),p.source_sha256,'Cloud source changed');
}
assert.equal(new Set(candidates.map(c=>`${c.date}|${c.start}|${c.room}`)).size,candidates.length);
for(const c of candidates){assert.ok(allowedRooms.includes(c.room));assert.ok(['16:45','18:35','20:25'].includes(c.start));assert.ok(c.date>='2026-10-21'&&c.date<'2026-12-01');}
const properties = c => ({
  '名前': {title:[{type:'text',text:{content:'個別使用可能'}}]},
  '日時': {date:{start:`${c.date}T${c.start}:00+09:00`,end:null,time_zone:null}},
  '教室': {select:{name:c.room}}, '校舎': {multi_select:[{name:'本校'}]},
  '内容': {multi_select:[{name:'個別指導'},{name:'個別使用可能'}]}, '担当者': {relation:[]},
});
const signature = row => `${row.date?.start ? new Date(row.date.start).toISOString() : ''}|${row.room}`;
const expectedSignature = c => `${new Date(`${c.date}T${c.start}:00+09:00`).toISOString()}|${c.room}`;
const logFile = `${dir}/created-pages.jsonl`;
const logs = fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const templatePages=JSON.parse(fs.readFileSync(`${dir}/notion-pages.json`,'utf8')).filter(p=>p.properties['内容']?.multi_select.some(t=>t.name==='個別使用可能')&&p.properties['日時']?.date?.start?.startsWith('2026-10'));
const icons=new Map();for(const p of templatePages){const k=JSON.stringify(p.icon??null);icons.set(k,(icons.get(k)??0)+1);}
const templateIcon=JSON.parse([...icons.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??'null');
if(mode === 'apply') {
  const before = JSON.parse(fs.readFileSync(`${dir}/notion-rows.json`,'utf8'));
  const current = (await readAllRelevant()).map(simplify);
  const ownIds=new Set(logs.map(l=>l.id));
  assert.equal(snapshotHash(current.filter(r=>!ownIds.has(r.id))),snapshotHash(before),'Existing Notion schedules changed since planning; refresh snapshot and plan');
  const known = new Set(current.map(signature));
  let created = 0, skipped = 0;
  for(const c of candidates){
    if(known.has(expectedSignature(c))){skipped++;continue;}
    if(Date.parse(`${c.date}T${c.start}:00+09:00`)<=Date.now()){skipped++;continue;}
    // Re-read the day immediately before insertion to catch newly added bookings.
    const dayPages = await query({and:[{property:'日時',date:{on_or_after:`${c.date}T00:00:00+09:00`}},{property:'日時',date:{before:`${c.date}T23:59:59+09:00`}}]});
    const start=Date.parse(`${c.date}T${c.start}:00+09:00`),end=Date.parse(`${c.date}T${c.end}:00+09:00`);
    const busy=dayPages.map(simplify).filter(r=>{
      if(!r.date?.start)return false;
      if(!r.room&&r.tags.includes('休み')&&r.teachers.length)return false;
      if(c.resolved_unassigned_rows?.some(x=>x.id===r.id&&x.edited===r.edited))return false;
      return r.room===c.room||!r.room&&r.campus.includes('本校')&&r.tags.some(t=>['個別指導','面談(対面)','診断テスト','入会手続き','見学打合せ','休み'].includes(t));
    }).some(r=>{
      const a=Date.parse(r.date.start.includes('T')?r.date.start:`${r.date.start}T00:00:00+09:00`);
      const b=r.date.end?Date.parse(r.date.end.includes('T')?r.date.end:`${r.date.end}T23:59:59+09:00`):r.date.start.includes('T')?a+90*60000:Date.parse(`${r.date.start}T23:59:59+09:00`);
      return a<end&&start<b;
    });
    if(busy){skipped++;continue;}
    // No automatic retry of a create: an uncertain response is reconciled by re-querying on resume.
    const result=await request('pages','POST',{parent:{type:'data_source_id',data_source_id:sourceId},properties:properties(c),icon:templateIcon});
    fs.appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),candidate:c,id:result.id,url:result.url})+'\n');
    known.add(expectedSignature(c));created++;
    if(created%20===0)console.log(JSON.stringify({created,skipped,total:candidates.length}));
  }
  console.log(JSON.stringify({mode,created,skipped,total:candidates.length}));
} else if(mode === 'verify') {
  const pages = await readAllRelevant();
  const current = pages.map(simplify);
  const byId = new Map(current.map(p=>[p.id,p]));
  const failures=[];
  for(const log of logs){
    const row=byId.get(log.id),c=log.candidate;
    if(!row||row.title!=='個別使用可能'||signature(row)!==expectedSignature(c)||row.date.end!==null||row.teachers.length||row.campus.join(',')!=='本校'||[...row.tags].sort().join(',')!==['個別指導','個別使用可能'].sort().join(','))failures.push(log.id);
    if(row&&current.some(r=>r.id!==row.id&&signature(r)===signature(row)))failures.push(`duplicate:${log.id}`);
    const full=pages.find(p=>p.id===log.id);if(full&&JSON.stringify(full.icon??null)!==JSON.stringify(templateIcon))failures.push(`icon:${log.id}`);
  }
  const before=JSON.parse(fs.readFileSync(`${dir}/notion-rows.json`,'utf8'));
  const changedBefore=before.filter(r=>!byId.has(r.id)||byId.get(r.id).edited!==r.edited).map(r=>r.id);
  assert.equal(failures.length,0,`Created page validation failed: ${failures.join(',')}`);
  assert.equal(changedBefore.length,0,'An existing Notion page changed during the operation');
  const missing=candidates.filter(c=>!current.some(r=>signature(r)===expectedSignature(c)&&r.tags.includes('個別使用可能')));
  assert.equal(missing.length,0,'Some planned slots are missing');
  const report={verified_at:new Date().toISOString(),verified:logs.length,created_by_month:Object.fromEntries(plans.map(p=>[p.month,logs.filter(l=>l.candidate.date.startsWith(p.month)).length])),existing_pages_changed:changedBefore,excluded_rooms_created:logs.filter(l=>!allowedRooms.includes(l.candidate.room)).length,review_by_month:Object.fromEntries(plans.map(p=>[p.month,p.review.length])),target_page:'https://app.notion.com/p/390f012080a780eb88d1c78e8f1ac00e'};
  fs.writeFileSync(`${dir}/verification.json`,JSON.stringify(report,null,2));
  fs.writeFileSync(`${dir}/notion-rows-after.json`,JSON.stringify(current,null,2));
  console.log(JSON.stringify(report,null,2));
} else throw new Error('Mode must be snapshot, apply, or verify');

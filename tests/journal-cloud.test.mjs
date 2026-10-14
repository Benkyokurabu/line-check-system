import test from 'node:test';
import assert from 'node:assert/strict';
import {listJournalCloudFiles} from '../src/lib/journal-cloud.mjs';
import {sealScheduleConnection} from '../src/lib/schedule-cloud.mjs';
const key='journal-test-only-server-key-123456789';
function setup(options={}){
  const config={driveId:'own',folderId:'schedules',clientId:'client',clientSecret:'secret',token:{access_token:'private-access',refresh_token:'private-refresh',expiry:'2099-01-01'}};
  const query={select(){return query;},eq(){return query;},async single(){return {data:{encrypted:sealScheduleConnection(config,key),version:1}};}};
  const db={from(){return query;}},calls=[];
  const file=(name,id)=>({name,id,file:{},webUrl:options.badUrl?'https://evil.invalid/':'https://onedrive.live.com/edit?id='+id,parentReference:{driveId:'owner'}});
  const fetcher=async(raw,init)=>{
    const url=decodeURIComponent(raw);calls.push(url);assert.equal(init.headers.Authorization,'Bearer private-access');assert.equal(init.redirect,'error');
    if(url.includes('/root:/●勉強クラブ共有'))return Response.json({remoteItem:{id:'shared',folder:{},parentReference:{driveId:'owner'}}});
    if(url.includes('/items/shared:/09　授業日誌'))return Response.json({id:'journals',folder:{}});
    if(url.includes('/items/journals/children'))return Response.json({value:[{id:'hon',name:'2026年３月～本校',folder:{}},{id:'south',name:'2026年３月～南教室',folder:{}},{id:'archive',name:'_backup',folder:{}}],...(options.badNext?{'@odata.nextLink':'https://evil.invalid/page'}:{})});
    if(url.includes('/items/hon/children'))return Response.json({value:[{id:'grade-h',name:'本校:中２',folder:{}},{id:'backup-h',name:'_backup',folder:{}},file('本校数学補講_2026.xlsx','extra-h')]});
    if(url.includes('/items/south/children'))return Response.json({value:[{id:'grade-s',name:'南教室:中２',folder:{}}]});
    if(url.includes('/items/grade-h/children'))return Response.json({value:[file('本校中２数学_2026.xlsx','h'),file('本校中２数学_2026_before.xlsx','before'),file('本校中２数学_2025.xlsx','old'),...(options.duplicate?[file('本校中２数学_2026.xlsx','different-h')]:[])]});
    if(url.includes('/items/grade-s/children'))return options.failure?new Response('',{status:503}):Response.json({value:[file('南教室中２X数学_2026.xlsx','s')]});
    throw Error('Unexpected URL '+url);
  };return {db,fetcher,calls};
}
test('共有元のドライブを辿り、現役原本とブラウザURLだけを返す',async()=>{
  const {db,fetcher,calls}=setup();const result=await listJournalCloudFiles(db,key,fetcher,new Date('2026-10-14'));
  assert.equal(result.year,2026);assert.equal(result.files.length,3);
  assert.deepEqual(result.files.map(f=>f.kind).sort(),['X','補講','通常'].sort());
  assert.ok(calls.some(url=>url.includes('/drives/owner/')));
  assert.ok(calls.every(url=>!url.includes('/items/backup-h/')&&!url.includes('/items/archive/')));
  for(const value of ['private-access','private-refresh','clientSecret','graph.microsoft'])assert.ok(!JSON.stringify(result).includes(value));
});
test('取得失敗・重複原本・不正リンク・外部ページングは部分成功扱いにしない',async()=>{
  for(const option of [{failure:true},{duplicate:true},{badUrl:true},{badNext:true}]){
    const {db,fetcher,calls}=setup(option);await assert.rejects(listJournalCloudFiles(db,key,fetcher,new Date('2026-10-14')));
    assert.ok(calls.every(url=>url.startsWith('https://graph.microsoft.com/')));
  }
});

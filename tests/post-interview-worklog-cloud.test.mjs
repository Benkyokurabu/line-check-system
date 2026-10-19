import {test} from 'node:test';import assert from 'node:assert/strict';
import {parentContactCloud,parentContactOptions} from '../src/lib/parent-contact-cloud.mjs';import {sealScheduleConnection} from '../src/lib/schedule-cloud.mjs';
const key='worklog-only-test-server-encryption-key';
function fixture({conflict=false,badNext=false,duplicate=false}={}){
 const calls=[],before=['','','','','～','','','','',''],after=['19日','工藤先生','保護者面談',16/24,'～',17/24,1/24,'見本の生徒+母','定期面談行事','解決'];let patched=false;
 const config={driveId:'own',folderId:'schedule',clientId:'id',clientSecret:'secret',token:{access_token:'private',refresh_token:'refresh',expiry:'2099-01-01'}};
 const q={select:()=>q,eq:()=>q,single:async()=>({data:{version:1,encrypted:sealScheduleConnection(config,key)}})},db={from:()=>q};
 const fetcher=async(raw,init={})=>{const url=decodeURIComponent(raw);calls.push({url,...init});assert.equal(init.headers.Authorization,'Bearer private');assert.equal(init.redirect,'error');
 if(url.includes('/root:/●勉強クラブ共有'))return Response.json({remoteItem:{id:'shared',folder:{},parentReference:{driveId:'owner'}}});
 if(url.includes('/items/shared/children'))return Response.json({value:[{id:'file',name:'004 担任業務記録簿2026年10月  対保護者.xlsx',file:{},webUrl:'https://onedrive.live.com/edit',parentReference:{driveId:'owner'}},...(duplicate?[{id:'duplicate',name:'004 担任業務記録簿2026年10月 対保護者.xlsx',file:{}}]:[])],...(badNext?{'@odata.nextLink':'https://evil.invalid/secret'}:{})});
 if(url.includes('/worksheets/リスト/'))return Response.json({values:[['','先生','摘要','結果','内容'],['','工藤先生','保護者面談','解決','定期面談行事']]});
 if(url.endsWith('/createSession'))return Response.json({id:'session'});
 if(url.endsWith('/closeSession'))return new Response(null,{status:204});
 if(url.includes('/worksheets/入力/')){
 if(init.method==='PATCH'){const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['values']);assert.ok(/address='(B78:E78|G78:G78|I78:K78)'/.test(url));patched=true;return Response.json({values:[after]});}
 return Response.json({values:[patched?after:conflict?['changed',...before.slice(1)]:before]});}
 throw Error('Unexpected Graph request');
 };return {db,fetcher,calls,before,after};
}
test('共有原本の選択肢を使い、保護された区切り・計算式を保持して記入する',async()=>{
 const f=fixture(),result=await parentContactOptions(f.db,key,'2026-10',f.fetcher);assert.deepEqual(result.teachers,['工藤先生']);assert.ok(!JSON.stringify(result).includes('private'));
 const cloud=await parentContactCloud(f.db,key,f.fetcher),file=await cloud.find('2026-10'),values=f.after.map((v,i)=>[4,6].includes(i)?null:v);assert.deepEqual(await cloud.write(file,78,values,f.before),f.after);assert.ok(f.calls.some(c=>c.url.includes('/drives/owner/')));assert.equal(f.calls.filter(c=>c.method==='PATCH').length,3);assert.ok(f.calls.at(-1).url.endsWith('/closeSession'));
});
test('原本重複・不正ページング・直前の行変更は書き込まない',async()=>{
 for(const option of [{duplicate:true},{badNext:true}]){const f=fixture(option),cloud=await parentContactCloud(f.db,key,f.fetcher);await assert.rejects(cloud.find('2026-10'));assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);assert.ok(f.calls.every(c=>c.url.startsWith('https://graph.microsoft.com/')));}
 const f=fixture({conflict:true}),cloud=await parentContactCloud(f.db,key,f.fetcher),file=await cloud.find('2026-10');await assert.rejects(cloud.write(file,78,f.after,f.before),/他の操作/);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,0);assert.ok(f.calls.at(-1).url.endsWith('/closeSession'));
});

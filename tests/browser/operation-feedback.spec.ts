import {test,expect,type Page} from '@playwright/test';
import {operationSupportToken,OPERATION_SUPPORT_COOKIE} from '../../src/lib/operation-support-token.mjs';
async function setup(page:Page){
 const state={status:503,analysisAvailable:true,stall:false,checks:0,diagnostics:[] as Array<Record<string,unknown>>,scheduleReads:0};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:3197')return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname==='/api/operation-analysis'){
   state.diagnostics.push(route.request().postDataJSON());
   if(!state.analysisAvailable)return route.fulfill({status:503,json:{code:'analysis_unavailable'}});
   const d=route.request().postDataJSON();return route.fulfill({json:{label:'AIによる分析',analysis:{assessment:d.status===403?'操作の権限に関係する可能性があります。設定の詳細までは分かりません。':'接続先の処理が遅れている可能性があります。内部の原因は未確定です。',nextStep:'画面の一覧や履歴で結果を確認してください。'}}});
  }
  if(url.pathname==='/api/attendance/extract'){
   state.checks++;if(state.stall)return new Promise<void>(()=>{});
   return route.fulfill({status:state.status,json:{error:'試験用の処理エラー SENSITIVE_MARKER'}});
  }
  if(url.pathname==='/api/attendance/status')return route.fulfill({json:{queued:0,ready:0,processing:0,dead:0,retry_wait:0}});
  if(url.pathname==='/api/attendance/candidates')return route.fulfill({json:{candidates:[]}});
  if(url.pathname==='/api/schedule/status')return route.fulfill({json:{enabled:true,stale:false,months:[],runs:[]}});
  if(url.pathname==='/api/schedule/preview'){
   state.scheduleReads++;
   if(!url.searchParams.has('month'))return route.fulfill({json:{months:[{month:'2026-10'}]}});
   return route.fulfill({status:503,json:{error:'原本の読取エラー SENSITIVE_MARKER'}});
  }
  return route.fulfill({json:{}});
 });return state;
}
test('a failed action explains observed facts and clearly labels AI inference beneath its button',async({page})=>{
 const state=await setup(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/attendance');const button=page.getByRole('button',{name:'最新のLINEを確認して更新',exact:true});
 await button.click();const panel=page.getByRole('region',{name:'操作の状況説明'});
 await expect(panel).toContainText('AIによる分析');await expect(panel).toContainText('原因は未確定');await expect(panel).toContainText('完了は、この情報だけでは判断できません');
 expect(state.diagnostics).toHaveLength(1);expect(state.diagnostics[0]).toMatchObject({area:'attendance',method:'POST',symptom:'http',status:503});
 expect(JSON.stringify(state.diagnostics)).not.toContain('SENSITIVE_MARKER');expect(Object.keys(state.diagnostics[0]).sort()).toEqual(['area','elapsedMs','method','online','status','symptom']);
 const b=await button.boundingBox(),p=await panel.boundingBox();expect(p!.y).toBeGreaterThanOrEqual(b!.y+b!.height);
 await expect(button).toBeEnabled();state.status=403;await button.click();await expect(panel).toContainText('権限に関係する可能性');expect(state.checks).toBe(2);expect(state.diagnostics).toHaveLength(2);
 await panel.getByRole('button',{name:'この状況説明を閉じる'}).click();await expect(panel).toHaveCount(0);expect(state.checks).toBe(2);expect(errors).toEqual([]);
});
test('AI unavailability never disguises fixed facts as AI output or retries a business action',async({page})=>{
 const state=await setup(page);state.analysisAvailable=false;await page.goto('/attendance');
 await page.getByRole('button',{name:'最新のLINEを確認して更新',exact:true}).click();
 const panel=page.getByRole('region',{name:'操作の状況説明'});await expect(panel).toContainText('AIの分析を取得できませんでした');await expect(panel).not.toContainText('AIによる分析');expect(state.checks).toBe(1);expect(state.diagnostics).toHaveLength(1);
});
test('slow responses show actual waiting state and the timeout remains an unknown outcome',async({page})=>{
 await page.clock.install();const state=await setup(page);state.stall=true;await page.goto('/attendance');
 await page.getByRole('button',{name:'最新のLINEを確認して更新',exact:true}).click();await expect.poll(()=>state.checks).toBe(1);
 await page.clock.runFor(3001);await expect(page.getByRole('region',{name:'操作の状況説明'})).toContainText('まだ結果を確認できていません');expect(state.diagnostics).toHaveLength(0);
 await page.clock.runFor(42001);await expect(page.getByRole('button',{name:'最新のLINEを確認して更新',exact:true})).toBeEnabled();await expect(page.getByRole('status')).toContainText('処理が続いている場合があります');
 await expect(page.getByRole('region',{name:'操作の状況説明'})).toContainText('AIによる分析');expect(state.diagnostics[0]).toMatchObject({symptom:'timeout',status:0});expect(state.checks).toBe(1);
});
test('the same mechanism covers schedule reads, retains selected month and fits mobile',async({page})=>{
 await page.setViewportSize({width:390,height:900});const state=await setup(page);await page.goto('/schedule-import');
 const button=page.getByRole('button',{name:'スケジュールを確認',exact:true});await expect(button).toBeEnabled();await button.click();
 const panel=page.getByRole('region',{name:'操作の状況説明'});await expect(panel).toContainText('授業スケジュール');await expect(panel).toContainText('AIによる分析');await expect(panel).toContainText('最新とは限りません');
 expect(state.diagnostics[0]).toMatchObject({area:'schedule',method:'GET',status:503});expect(JSON.stringify(state.diagnostics)).not.toContain('SENSITIVE_MARKER');
 await expect(page.getByLabel('対象月',{exact:true})).toHaveValue('2026-10');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/operation-feedback-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'トップページへ',exact:false}).first().click();await expect(panel).toHaveCount(0);
});
test('analysis endpoint requires same origin and authorized diagnostic scope without querying the business DB',async({request})=>{
 const body={area:'attendance',method:'POST',symptom:'timeout',status:0,elapsedMs:45000,online:true};
 const denied=await request.post('/api/operation-analysis',{data:body,headers:{Origin:'https://outside.invalid'}});expect(denied.status()).toBe(403);
 const anonymous=await request.post('/api/operation-analysis',{data:body,headers:{Origin:'https://test.invalid'}});expect(anonymous.status()).toBe(401);
 const token=operationSupportToken({staffId:'test-staff',expiresAt:new Date(Date.now()+3600000).toISOString()},'isolated-test-not-a-real-key');
 const malformed=await request.post('/api/operation-analysis',{data:{...body,text:'PRIVATE'},headers:{Origin:'https://test.invalid',Cookie:`${OPERATION_SUPPORT_COOKIE}=${token.value}`}});expect(malformed.status()).toBe(400);
 const authorized=await request.post('/api/operation-analysis',{data:body,headers:{Origin:'https://test.invalid',Cookie:`${OPERATION_SUPPORT_COOKIE}=${token.value}`}});
 expect(authorized.status()).toBe(503);expect((await authorized.json()).code).toBe('analysis_unavailable');
});

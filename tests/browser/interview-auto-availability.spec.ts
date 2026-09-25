import {test,expect} from '@playwright/test';

const base={month:'2026-10',teacher:'工藤',startTime:'14:00',lessonDays:2,hash:'a'.repeat(64)};
test.beforeEach(async({page})=>{
 await page.route('**/api/admin/teachers',route=>route.fulfill({json:{teachers:[
  {id:'00000000-0000-4000-8000-000000000001',display_name:'工藤'},
  {id:'00000000-0000-4000-8000-000000000002',display_name:'金城'},
  {id:'00000000-0000-4000-8000-000000000003',display_name:'髙山'},
 ]}}));
});

test('先生名と共通パスワードで本人の予約可能枠へログインする',async({page})=>{
 let loggedIn=false;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({status:401,json:{error:'ログインし直してください。'}}));
 await page.route('**/api/staff/availability-login',route=>{
  expect(route.request().postDataJSON()).toMatchObject({teacherId:'00000000-0000-4000-8000-000000000003'});
  loggedIn=true;return route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000013',staffCode:'AVAIL_00000000000040008000000000000003',displayName:'髙山',role:'teacher'}}});
 });
 await page.goto('/staff/interview-availability');
 await page.getByLabel('先生の名前').selectOption({label:'髙山先生'});
 await page.getByLabel('共通パスワード').fill('test-password');
 await page.getByRole('button',{name:'ログイン',exact:true}).click();
 await expect(page.getByRole('heading',{name:'髙山さんの受付枠'})).toBeVisible();
 await expect(page.getByRole('region',{name:'先生別の月次実行状況'})).toHaveCount(0);
 expect(loggedIn).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('開始時間11:00の指定をプレビューと反映の両方へ渡す',async({page})=>{
 let applied=false;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/schedule/sync?*',route=>route.fulfill({json:{status:'unchanged'}}));
 await page.route('**/api/staff/interview-auto-availability*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.searchParams.get('overview')==='1')return route.fulfill({json:{month:'2026-10',teachers:[]}});
  if(request.method()==='POST'){
   expect(request.postDataJSON().startTime).toBe('11:00');applied=true;
   return route.fulfill({json:{saved:{applied:[{action:'create'}]}}});
  }
  expect(url.searchParams.get('startTime')).toBe('11:00');
  return route.fulfill({json:{...base,startTime:'11:00',summary:{create:applied?0:1,update:0,archive:0,keep:applied?1:0,skip:0,review:0},items:[{key:'2026-10-02|11:00',date:'2026-10-02',start:'11:00',end:'11:45',campus:'本校',action:applied?'keep':'create',reason:'新しく作成'}]}});
 });
 await page.goto('/staff/interview-availability');
 await page.getByLabel('候補の開始時間').selectOption('11:00');
 await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('11:00から');
 await page.getByRole('button',{name:'この内容をNotionへ反映'}).click();
 await page.getByRole('dialog',{name:'予約可の反映確認'}).getByRole('button',{name:'Notionへ反映する'}).click();
 expect(applied).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('独立メニューで翌月表を同期し、確認後だけ本人の予約可を反映する',async({page})=>{
 let synced=false,applied=false,posts=0;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/schedule/sync?*',route=>{synced=true;return route.fulfill({json:{status:'unchanged',message:'原本と登録済み授業は一致しています。'}});});
 await page.route('**/api/staff/interview-auto-availability*',route=>{
  if(new URL(route.request().url()).searchParams.get('overview')==='1')return route.fulfill({json:{month:'2026-10',teachers:[{teacher:'工藤',status:applied?'review':'not-run',lessonDays:2,activeSlots:applied?1:0,reviewCount:applied?1:0,finishedAt:applied?'2026-09-24T10:00:00Z':null}]}});
  expect(synced).toBe(true);if(route.request().method()==='POST'){posts++;applied=true;expect(route.request().postDataJSON()).toMatchObject({month:'2026-10',previewHash:'a'.repeat(64)});return route.fulfill({json:{saved:{applied:[{action:'create'}]}}});}
  return route.fulfill({json:applied?{...base,summary:{create:0,update:0,archive:0,keep:1,skip:0,review:1},items:[{key:'2026-10-04|14:00',date:'2026-10-04',start:'14:00',end:'14:45',campus:'本校',action:'keep',reason:'変更なし'},{key:'2026-10-10|review',date:'2026-10-10',start:'',end:'',campus:'',action:'review',reason:'同日に複数校舎の授業があります。'}]}:{...base,summary:{create:1,update:0,archive:0,keep:0,skip:0,review:1},items:[{key:'2026-10-04|14:00',date:'2026-10-04',start:'14:00',end:'14:45',campus:'本校',action:'create',reason:'新しく作成'},{key:'2026-10-10|review',date:'2026-10-10',start:'',end:'',campus:'',action:'review',reason:'同日に複数校舎の授業があります。'}]}});
 });
 await page.goto('/staff/interview-availability');await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 const preview=page.locator('[aria-label="予約可の反映予定"]');await expect(preview).toContainText('作成 1');await expect(preview).toContainText('要確認 1');await expect(preview).toContainText('2026-10-04 14:00〜14:45');expect(posts).toBe(0);
 await page.getByRole('button',{name:'この内容をNotionへ反映'}).click();const dialog=page.getByRole('dialog',{name:'予約可の反映確認'});await expect(dialog).toContainText('作成 1件');await dialog.getByRole('button',{name:'Notionへ反映する'}).click();
 await expect(page.getByRole('status')).toContainText('1件をNotionへ反映しました');expect(posts).toBe(1);await expect(preview).toContainText('変更なし 1');await expect(page.getByRole('region',{name:'先生別の月次実行状況'})).toContainText('工藤先生：要確認あり');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('金城は独立メニューで自分の受付枠だけを確認する',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000002',staffCode:'KINJO',displayName:'金城正樹',role:'admin'}}}));
 await page.route('**/api/staff/interview-auto-availability?*',route=>new URL(route.request().url()).searchParams.get('overview')==='1'?route.fulfill({json:{month:'2026-10',teachers:[]}}):route.fulfill({json:{...base,teacher:'金城',startTime:'11:00',summary:{create:1,update:0,archive:0,keep:0,skip:0,review:0},items:[{key:'2026-10-03|22:05',date:'2026-10-03',start:'22:05',end:'',campus:'本校',action:'create',reason:'新しく作成'}]}}));
 await page.route('**/api/schedule/sync?*',route=>route.fulfill({json:{status:'unchanged',message:'同期済み'}}));await page.goto('/staff/interview-availability');await expect(page.getByRole('heading',{name:'金城正樹さんの受付枠'})).toBeVisible();
 await expect(page.getByLabel('候補の開始時間')).toHaveCount(0);
 await expect(page.getByText(/22:05開始は20:25〜21:55の授業がある日だけ作成/)).toBeVisible();
 await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('金城先生');
 await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('22:05〜（終了時刻なし）');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('別月の同期と重なっても、原本と授業が一致していれば予約枠を確認できる',async({page})=>{
 let inspected=false;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/schedule/sync?*',route=>route.fulfill({json:{status:'busy',message:'直前の処理を実行中、または完了直後です。少し待って結果を確認してください。'}}));
 await page.route('**/api/schedule/preview?*',route=>route.fulfill({json:{month:'2026-10',summary:{existing:397,incoming:397,unchanged:397,add:0,update:0,remove:0,ambiguous:0}}}));
 await page.route('**/api/staff/interview-auto-availability?*',route=>{
  if(new URL(route.request().url()).searchParams.get('overview')==='1')return route.fulfill({json:{month:'2026-10',teachers:[]}});
  inspected=true;return route.fulfill({json:{...base,summary:{create:1,update:0,archive:0,keep:0,skip:0,review:0},items:[]}});
 });
 await page.goto('/staff/interview-availability');await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('作成 1');
 await expect(page.getByRole('status')).toContainText('原本と登録済み授業が一致');
 expect(inspected).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('同期中に原本の未反映変更があれば予約枠を表示しない',async({page})=>{
 let inspected=false;
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/schedule/sync?*',route=>route.fulfill({json:{status:'busy'}}));
 await page.route('**/api/schedule/preview?*',route=>route.fulfill({json:{month:'2026-10',summary:{existing:396,incoming:397,unchanged:396,add:1,update:0,remove:0,ambiguous:0}}}));
 await page.route('**/api/staff/interview-auto-availability?*',route=>{
  if(new URL(route.request().url()).searchParams.get('overview')==='1')return route.fulfill({json:{month:'2026-10',teachers:[]}});
  inspected=true;return route.fulfill({json:{...base,summary:{create:1,update:0,archive:0,keep:0,skip:0,review:0},items:[]}});
 });
 await page.goto('/staff/interview-availability');await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 await expect(page.getByRole('status')).toContainText('未反映の変更');
 await expect(page.locator('[aria-label="予約可の反映予定"]')).toHaveCount(0);expect(inspected).toBe(false);
});

test('29日の両校舎表記では勤務校舎を尋ね、再確認後だけ反映できる',async({page})=>{
 let selected=false,applied=false;
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'00000000-0000-4000-8000-000000000001',staffCode:'KUDO',displayName:'工藤謙',role:'admin'}}}));
 await page.route('**/api/schedule/sync?*',route=>route.fulfill({json:{status:'unchanged',message:'同期済み'}}));
 await page.route('**/api/staff/interview-auto-availability*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.searchParams.get('overview')==='1')return route.fulfill({json:{month:'2026-10',teachers:[]}});
  if(request.method()==='POST'){expect(request.postDataJSON().campusChoices).toEqual({'2026-10-29':'南教室'});applied=true;return route.fulfill({json:{saved:{applied:[{action:'create'}]}}});}
  const choices=JSON.parse(url.searchParams.get('campusChoices')??'{}');if(choices['2026-10-29']==='南教室')selected=true;
  const item=applied?{key:'2026-10-29|14:00',date:'2026-10-29',start:'14:00',end:'14:45',campus:'南教室',action:'keep',reason:'変更なし'}:selected?{key:'2026-10-29|14:00',date:'2026-10-29',start:'14:00',end:'14:45',campus:'南教室',action:'create',reason:'新しく作成'}:{key:'2026-10-29|review',date:'2026-10-29',start:'',end:'',campus:'',action:'review',needsCampusChoice:true,reason:'実際に勤務する校舎を選んでください。'};
  return route.fulfill({json:{...base,summary:{create:selected&&!applied?1:0,update:0,archive:0,keep:applied?1:0,skip:0,review:selected?0:1},campusDecisions:selected?[{date:'2026-10-29',campus:'南教室',source:applied?'saved':'selected'}]:[],items:[item]}});
 });
 await page.goto('/staff/interview-availability');await page.getByRole('button',{name:'スケジュール表から枠を確認'}).click();
 await expect(page.getByLabel('勤務校舎の選択')).toContainText('2026-10-29');await expect(page.getByRole('button',{name:'この内容をNotionへ反映'})).toBeDisabled();
 await page.getByLabel('2026-10-29の勤務校舎').selectOption('南教室');await page.getByRole('button',{name:'選んだ校舎で枠を再確認'}).click();
 await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('2026-10-29 14:00〜14:45');await expect(page.locator('[aria-label="予約可の反映予定"]')).toContainText('勤務校舎の確認：2026-10-29 南教室');
 await page.getByRole('button',{name:'この内容をNotionへ反映'}).click();await page.getByRole('dialog',{name:'予約可の反映確認'}).getByRole('button',{name:'Notionへ反映する'}).click();
 await expect(page.getByRole('status')).toContainText('1件をNotionへ反映しました');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

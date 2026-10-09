import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const id='00000000-0000-4000-8000-000000000001';
const expected='① 10月12日（月）14:00〜14:45\n② 10月14日（水）15:00〜15:45';
test('トップページの左メニュー面談にコピーカードを並べ、直接移動できる',async({page})=>{
 await page.route('**/api/interview-surveys**',route=>route.fulfill({json:{groups:[],states:[],scheduling:[]}}));
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{displayName:'工藤謙'}}}));
 await page.route('**/api/staff/interview-manual-availability*',route=>route.fulfill({json:{rows:[]}}));
 await page.route('**/api/staff/interview-availability-copy*',route=>route.fulfill({json:{teachers:[{id,name:'工藤先生'}],defaultTeacherId:id}}));
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.goto('/');
  await page.getByRole('navigation',{name:'機能の分類'}).getByRole('button',{name:'面談',exact:true}).click();
  await expect(page.getByRole('heading',{level:3})).toHaveText(['面談の予定・入力','面談資料を作る','予約可能枠を作る','予約可能枠をコピー']);
  const link=page.getByRole('link',{name:/予約可能枠をコピー/});await expect(link).toBeVisible();await expect(link).toHaveAttribute('href','/staff/interview-availability/manual');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/availability-copy-home-${width}.png`,fullPage:true});
  await link.click();await expect(page).toHaveURL(/\/staff\/interview-availability\/manual$/);await expect(page.getByRole('region',{name:'予約可能枠をコピー'})).toBeVisible();
 }
});
test('左メニューの面談から予約可能枠コピー画面を直接開く',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{displayName:'工藤謙'}}}));
 await page.route('**/api/staff/interview-manual-availability*',route=>route.fulfill({json:{rows:[]}}));
 await page.route('**/api/staff/interview-availability-copy*',route=>route.fulfill({json:{teachers:[{id,name:'工藤先生'}],defaultTeacherId:id}}));
 await page.setViewportSize({width:1280,height:900});await page.goto('/feedback');
 const group=page.getByRole('navigation',{name:'業務ナビゲーション'}).locator('.app-nav-group').filter({has:page.getByText('面談',{exact:true})});
 await expect(group.getByRole('link')).toHaveText(['面談の予定・入力','面談資料を作る','予約可能枠を作る','予約可能枠をコピー']);
 await group.getByRole('link',{name:'予約可能枠をコピー',exact:true}).click();await expect(page).toHaveURL(/\/staff\/interview-availability\/manual$/);
 await expect(page.getByRole('region',{name:'予約可能枠をコピー'})).toBeVisible();await expect(group.getByRole('link',{name:'予約可能枠をコピー',exact:true})).toHaveAttribute('aria-current','page');
 await page.screenshot({path:'test-results/availability-copy-menu-desktop.png'});
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('region',{name:'予約可能枠をコピー'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('設計HTMLの操作例と表示を確認する',async({page})=>{
 await page.setContent(fs.readFileSync('docs/availability-copy-flow.html','utf8'));
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'日程の表示例を見る'}).click();await expect(page.getByLabel('コピーする日程')).toHaveValue('① 10月12日（月）14:00〜14:45\n② 10月12日（月）15:00〜15:45');
  await page.locator('summary').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/availability-copy-design-${width}.png`,fullPage:true});await page.locator('summary').click();
 }
 await page.getByLabel('開始日').fill('2026-10-26');await expect(page.getByLabel('コピーする日程')).toBeHidden();await page.getByRole('button',{name:'来週の月曜〜土曜'}).click();await expect(page.getByLabel('開始日')).toHaveValue('2026-10-12');
});
test('来週の期間・先生切替・コピー・失敗・0件をスマートフォンで確認する',async({page,context})=>{
 await page.clock.install({time:new Date('2026-10-09T02:00:00Z')});
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 let mode='ok',posts=0;const queries:URLSearchParams[]=[];
 page.on('request',request=>{if(request.method()==='POST')posts++;});
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{displayName:'工藤謙',staffCode:'KUDO',role:'admin'}}}));
 await page.route('**/api/staff/interview-manual-availability*',route=>route.fulfill({json:{rows:[]}}));
 await page.route('**/api/staff/interview-availability-copy*',route=>{
  const query=new URL(route.request().url()).searchParams;
  if(query.get('mode')==='teachers')return route.fulfill({json:{teachers:[{id,name:'工藤先生'},{id:'other',name:'金城先生'}],defaultTeacherId:id}});
  queries.push(query);
  if(mode==='fail')return route.fulfill({status:503,json:{error:'Notionの取得に失敗しました。'}});
  return route.fulfill({json:{teacher:'工藤先生',teacherId:id,from:query.get('from'),to:query.get('to'),rows:mode==='empty'?[]:[{},{}],text:mode==='empty'?'':expected,checkedAt:'2026-10-09T02:00Z',conflictCount:1,reviewCount:0}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/staff/interview-availability/manual');
 const panel=page.getByRole('region',{name:'予約可能枠をコピー'});
 await expect(panel.getByLabel('開始日')).toHaveValue('2026-10-12');await expect(panel.getByLabel('終了日')).toHaveValue('2026-10-17');await expect(panel.getByLabel('担当の先生')).toHaveValue(id);
 await panel.getByRole('button',{name:'Notionから予約可を取得'}).click();
 await expect(panel.getByLabel('コピーする日程')).toHaveValue(expected);
 await panel.getByRole('button',{name:'日程一覧をコピー'}).click();
 expect((await page.evaluate(()=>navigator.clipboard.readText())).replaceAll('\r\n','\n')).toBe(expected);await expect(panel.getByRole('status')).toContainText('2件');
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/availability-copy-mobile.png',fullPage:true});
 await panel.getByLabel('担当の先生').selectOption('other');await expect(panel.getByRole('button',{name:'日程一覧をコピー'})).toHaveCount(0);
 await panel.getByLabel('開始日').fill('2026-10-26');await panel.getByLabel('終了日').fill('2026-11-07');
 await panel.getByRole('button',{name:'Notionから予約可を取得'}).click();await expect(panel.getByLabel('コピーする日程')).toBeVisible();
 expect(queries.at(-1)?.get('from')).toBe('2026-10-26');expect(queries.at(-1)?.get('teacherId')).toBe('other');
 mode='fail';await panel.getByRole('button',{name:'Notionから予約可を取得'}).click();await expect(panel.getByRole('status')).toContainText('失敗');await expect(panel.getByLabel('コピーする日程')).toHaveCount(0);
 mode='empty';await panel.getByRole('button',{name:'Notionから予約可を取得'}).click();await expect(panel).toContainText('この期間の予約可能枠はありません。');await expect(panel.getByRole('button',{name:'日程一覧をコピー'})).toHaveCount(0);
 await panel.getByRole('button',{name:'来週の月曜〜土曜'}).click();await expect(panel.getByLabel('開始日')).toHaveValue('2026-10-12');
 expect(posts).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('コピーが拒否された場合は一覧を選択する',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(Error('denied'))}}));
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{displayName:'工藤謙'}}}));
 await page.route('**/api/staff/interview-manual-availability*',route=>route.fulfill({json:{rows:[]}}));
 await page.route('**/api/staff/interview-availability-copy*',route=>route.fulfill({json:new URL(route.request().url()).searchParams.get('mode')==='teachers'?{teachers:[{id,name:'工藤先生'}],defaultTeacherId:id}:{teacher:'工藤先生',from:'2026-10-12',to:'2026-10-17',rows:[{},{}],text:expected,checkedAt:'2026-10-09T02:00Z'}}));
 await page.goto('/staff/interview-availability/manual');const panel=page.getByRole('region',{name:'予約可能枠をコピー'});await panel.getByRole('button',{name:'Notionから予約可を取得'}).click();await panel.getByRole('button',{name:'日程一覧をコピー'}).click();await expect(panel.getByRole('status')).toContainText('選択された一覧');expect(await panel.getByLabel('コピーする日程').evaluate((e:HTMLTextAreaElement)=>e.selectionEnd-e.selectionStart)).toBe(expected.length);
});

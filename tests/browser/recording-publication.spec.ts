import {test,expect} from '@playwright/test';
test('administrator can hide, schedule and restore a recording on mobile; failed saves preserve input',async({page})=>{
 let loggedIn=false,version=0,mode='public',release:string|null=null,fail=true;
 const key='2026-10-01|6:35～8:05|hon|hon_j1_S_math|2';
 const writes:Record<string,unknown>[]=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(String(test.info().project.use.baseURL)).origin)return route.abort();
  if(url.pathname==='/api/staff/session'){
   if(route.request().method()==='POST')loggedIn=true;
   if(route.request().method()==='DELETE')loggedIn=false;
   return loggedIn?route.fulfill({json:{staff:{staffId:'test-admin',role:'admin',displayName:'管理者'}}}):route.fulfill({status:401,json:{error:'ログインしてください。'}});
  }
  if(url.pathname==='/api/staff/recordings'){
   if(!loggedIn)return route.fulfill({status:401,json:{error:'ログインしてください。'}});
   if(route.request().method()==='POST'){
    const body=route.request().postDataJSON();writes.push(body);
    if(fail){fail=false;return route.fulfill({status:503,json:{error:'一時的な接続エラー'}});}
    version++;mode=body.mode;release=mode==='scheduled'?'2099-10-10T13:00:00.000Z':null;
    return route.fulfill({json:{saved:true}});
   }
   return route.fulfill({json:{rows:[{key,lesson:{date:'2026-10-01',time:'6:35～8:05',campus:'hon',label:'中1S 数学',room:'2'},status:mode==='public'?'public':'hidden',jsonHidden:mode!=='public',rule:version?{mode,release_at:release,version}:undefined}]}});
  }
  if(url.pathname.startsWith('/api/'))return route.abort();
  return route.continue();
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('/staff/recordings');
 await expect(page.getByText('中1S 数学',{exact:false})).toHaveCount(0);
 await page.getByLabel('パスワード',{exact:true}).fill('test-only');
 await page.getByRole('button',{name:'ログイン',exact:true}).click();
 await page.getByRole('button',{name:/中1S 数学の公開設定/}).click();
 await expect(page.getByLabel('公開方法')).toHaveValue('private');
 await page.getByRole('button',{name:'この設定で保存'}).click();
 await expect(page.getByRole('main').getByRole('alert')).toContainText('一時的な接続エラー');
 await expect(page.getByLabel('公開方法')).toHaveValue('private');
 await page.getByRole('button',{name:'この設定で保存'}).click();
 await expect(page.getByRole('status')).toContainText('公開設定を保存');
 expect(writes[0]).toEqual(writes[1]);
 await page.getByLabel('公開方法').selectOption('scheduled');
 await page.getByLabel('公開日時（日本時間）').fill('2099-10-10T22:00');
 await page.getByRole('button',{name:'この設定で保存'}).click();
 await expect(page.getByText('公開待ち：2099-10-10 22:00',{exact:true})).toBeVisible();
 await page.getByLabel('公開方法').selectOption('public');
 await page.getByRole('button',{name:'この設定で保存'}).click();
 await expect(page.getByText('公開JSONに録画URLを掲載済み',{exact:true})).toBeVisible();
 expect(writes.at(-1)?.version).toBe(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/recording-publication-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'ログアウト'}).click();
 await expect(page.getByRole('heading',{name:'管理者ログイン'})).toBeVisible();
 await expect(page.getByText('中1S 数学',{exact:false})).toHaveCount(0);
});
for(const scenario of ['waiting','complete','unavailable','missing'] as const){
 test(`Notion shared campus settings on mobile: ${scenario}`,async({page})=>{
  const key='2026-10-01|18:35～20:05|hon|hon_j1_S_math|2',id='00000000-0000-0000-0000-000000000001';
  const writes:Record<string,unknown>[]=[];
  const complete=scenario==='complete',unavailable=scenario==='unavailable';
  await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'test-admin',role:'admin',displayName:'管理者'}}}));
  await page.route('**/api/staff/recordings*',async route=>{
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{saved:true,rule:{version:2}}});}
   return route.fulfill({json:{notionError:unavailable?'Notionの両教室のチェックを確認できません。':'',rows:[{key,lesson:{date:'2026-10-01',time:'18:35～20:05',campus:'hon',label:'中1S 数学',room:'2'},status:complete?'public':'hidden',jsonHidden:!complete,notionOptions:scenario==='missing'?[]:[{id,test:'2026.10 単元テスト③',campus:'本校',lesson:'数学1S'}],rule:{mode:'notion',version:1,notion_page_id:id,notion_checks:[{campus:'本校',ready:true,verified:true},{campus:'南教室',ready:complete,verified:!unavailable}],notion_error:unavailable?'Notionの両教室のチェックを確認できないため非公開を維持しています。':''}}]}});
  });
  await page.setViewportSize({width:390,height:844});await page.goto('/staff/recordings');
  await page.getByRole('button',{name:/中1S 数学の公開設定/}).click();
  await expect(page.getByLabel('公開方法')).toHaveValue('notion');
  await expect(page.getByText('片方だけの完了では公開しません。',{exact:false})).toBeVisible();
  await expect(page.getByText('本校：完了',{exact:true})).toBeVisible();
  await expect(page.getByText(`南教室：${unavailable?'進捗行を確認できません':complete?'完了':'チェック待ち'}`,{exact:true})).toBeVisible();
  if(scenario==='missing')await expect(page.getByRole('button',{name:'この設定で保存'})).toBeDisabled();
  else{await page.getByRole('button',{name:'この設定で保存'}).click();await expect(page.getByRole('status')).toContainText('公開設定を保存');expect(writes[0]).toMatchObject({key,mode:'notion',notionPageId:id,version:1});}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/recording-notion-${scenario}-mobile.png`,fullPage:true});
 });
}
test('non-administrator cannot see the recording list or settings buttons',async({page})=>{
 let requested=false;
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'teacher',role:'teacher',displayName:'先生'}}}));
 await page.route('**/api/staff/recordings*',route=>{requested=true;return route.fulfill({status:403,json:{error:'権限なし'}});});
 await page.goto('/staff/recordings');
 await expect(page.getByRole('heading',{name:'管理者専用です'})).toBeVisible();
 await expect(page.getByLabel('公開方法')).toHaveCount(0);
 expect(requested).toBe(false);
});

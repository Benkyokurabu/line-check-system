import {expect,test} from '@playwright/test';
const staff={staffId:'journal-staff',staffCode:'AVAIL_test',displayName:'確認担当',role:'teacher'};
const files=[
  {id:'h-math',name:'本校中２数学_2026.xlsx',campus:'本校',grade:'中2',subject:'数学',subjectId:'math',kind:'通常',url:'https://onedrive.live.com/edit?id=hon-math'},
  {id:'s-math',name:'南教室中２数学_2026.xlsx',campus:'南教室',grade:'中2',subject:'数学',subjectId:'math',kind:'通常',url:'https://onedrive.live.com/edit?id=south-math'},
  {id:'h-eng',name:'本校中２英語_2026.xlsx',campus:'本校',grade:'中2',subject:'英語',subjectId:'english',kind:'通常',url:'https://onedrive.live.com/edit?id=hon-english'},
];
for(const width of [1280,390])test(`授業・管理から科目・校舎を選んで開き、ブロック分だけ再試行 (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
  await page.route('**/api/staff/session/activity',r=>r.fulfill({json:{authenticated:true}}));
  await page.route('**/api/staff/journals',r=>r.fulfill({json:{year:2026,files}}));
  await page.goto('/');
  await page.getByRole('button',{name:'授業・管理',exact:true}).click();
  await page.getByRole('link',{name:/授業日誌の確認/}).click();
  await expect(page.getByRole('heading',{name:'授業日誌の確認',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ブラウザで開く',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'算数・数学',exact:true}).click();
  await expect(page.getByText('2026年度 ／ 算数・数学 ／ 全部：2件',{exact:true})).toBeVisible();
  await page.evaluate(()=>{const state=window as unknown as {opened:string[];block:boolean};state.opened=[];state.block=true;window.open=((url?:string|URL)=>{state.opened.push(String(url));return state.block&&String(url).includes('south')?null:{opener:null};}) as typeof window.open;});
  await page.getByRole('button',{name:'ブラウザで開く',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('1件はブラウザにブロック');
  await expect(page.getByRole('region',{name:'ブロックされた日誌'})).toBeVisible();
  await page.evaluate(()=>{(window as unknown as {block:boolean}).block=false;});
  await page.getByRole('button',{name:'開けなかった日誌を開く',exact:true}).click();
  expect(await page.evaluate(()=>(window as unknown as {opened:string[]}).opened)).toEqual([files[0].url,files[1].url,files[1].url]);
  await page.getByRole('radio',{name:'本校',exact:true}).check();
  await expect(page.getByText('2026年度 ／ 算数・数学 ／ 本校：1件',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:'南教室',exact:true}).check();
  await expect(page.getByText('2026年度 ／ 算数・数学 ／ 南教室：1件',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'英語',exact:true}).click();
  await expect(page.getByRole('button',{name:'ブラウザで開く',exact:true})).toBeDisabled();
  await page.getByRole('radio',{name:'全部',exact:true}).check();
  await page.getByRole('button',{name:'ブラウザで開く',exact:true}).click();
  expect((await page.evaluate(()=>(window as unknown as {opened:string[]}).opened)).at(-1)).toBe(files[2].url);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/journals-${width}.png`,fullPage:true});
});
test('取得中や失敗時は開けず、再読み込み後に実行できる',async({page})=>{
  await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
  let fail=true;
  await page.route('**/api/staff/journals',r=>r.fulfill(fail?{status:503,json:{error:'OneDriveの取得に失敗しました。'}}:{json:{year:2026,files}}));
  await page.goto('/staff/journals');await page.getByRole('button',{name:'算数・数学',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('OneDrive');
  await expect(page.getByRole('button',{name:'ブラウザで開く',exact:true})).toBeDisabled();
  fail=false;await page.getByRole('button',{name:'日誌を再読み込み',exact:true}).click();
  await expect(page.getByRole('button',{name:'ブラウザで開く',exact:true})).toBeEnabled();
});
test('未ログインではOneDriveリンクを取得せず、日誌APIも認証必須',async({page,request})=>{
  const response=await request.get('/api/staff/journals');expect(response.status()).toBe(401);expect(await response.json()).not.toHaveProperty('files');
  await page.route('**/api/staff/session',r=>r.fulfill({status:401,json:{error:'ログインしてください'}}));
  await page.route('**/api/staff/login-people',r=>r.fulfill({json:{teachers:[]}}));
  let reads=0;await page.route('**/api/staff/journals',r=>{reads++;return r.fulfill({json:{year:2026,files}});});
  await page.goto('/staff/journals');await expect(page.getByRole('heading',{name:'先生ログイン'})).toBeVisible();expect(reads).toBe(0);
});
test('実際のタブ起動で原本のURLへ遷移し、起動元への参照を残さない',async({page,context})=>{
  await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
  await page.route('**/api/staff/journals',r=>r.fulfill({json:{year:2026,files}}));
  await context.route('https://onedrive.live.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Excel原本のテスト</h1>'}));
  await page.goto('/staff/journals');await page.getByRole('button',{name:'算数・数学',exact:true}).click();
  await expect(page.getByRole('button',{name:'ブラウザで開く',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'ブラウザで開く',exact:true}).click();
  await expect.poll(()=>context.pages().length).toBe(3);
  const tabs=context.pages().filter(tab=>tab!==page);
  await expect.poll(()=>tabs.map(tab=>tab.url()).sort()).toEqual(files.slice(0,2).map(file=>file.url).sort());
  for(const tab of tabs)expect(await tab.evaluate(()=>window.opener)).toBe(null);
});

import {test,expect} from '@playwright/test';
import {blankEnrollmentFields} from '../../src/lib/enrollment-core.mjs';
const id='11111111-1111-4111-8111-111111111111',intake='22222222-2222-4222-8222-222222222222';
const staff={staffId:'staff',staffCode:'KUDO',displayName:'工藤',role:'admin'};
function model(){return {entry:null,payload:{studentPageId:id,intakePageId:intake,fields:blankEnrollmentFields(),record:'',sourceText:''},student:{id,name:'見本の生徒',number:'2026999',url:'https://notion.so/student',values:{'所属':'本校','学年':'中２','状態':'入会表明','本当の入塾日':''}},intakes:[{id:intake,title:'入会希望',status:'入塾表明あり',date:'',snapshot:'i',url:'https://notion.so/intake'}],snapshot:'s',stableSnapshot:'stable',actorIssue:''};}
for(const width of [1280,390])test(`一つの入力・別々の日付・固定文・判断待ち・反映結果 ${width}px`,async({page})=>{
 const context=model();let submitted:Record<string,unknown>|null=null;
 await page.setViewportSize({width,height:1000});
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/enrollment*',async r=>{
  const u=new URL(r.request().url());
  if(r.request().method()==='POST'){
   submitted=r.request().postDataJSON();
   const entry={id:'33333333-3333-4333-8333-333333333333',version:1,status:'review',payload:submitted!.payload,targets:{student:{status:'synced'},interview:{status:'synced'},intake:{status:'review',error:'クラスを判断してください。'},mtg:{status:'synced'}}};
   Object.assign(context,{entry,payload:entry.payload});await r.fulfill({json:{entry}});return;
  }
  if(u.searchParams.has('q'))return r.fulfill({json:{students:[{id,name:'見本の生徒',number:'2026999',campus:'本校',grade:'中２',status:'入会表明'}]}});
  if(u.searchParams.has('student')||u.searchParams.has('entry'))return r.fulfill({json:context});
  if(u.searchParams.has('history'))return r.fulfill({json:{history:[{id:'old',date:'2026-10-01',title:'見学打合せ',purpose:'見学',url:'https://notion.so/old'}]}});
  return r.fulfill({json:{entries:[]}});
 });
 await page.goto('/staff/enrollment');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を検索',exact:true}).click();await page.getByRole('button',{name:/見本の生徒 ／/}).click();
 await expect(page.getByLabel('入塾日',{exact:true})).toHaveValue('');await page.getByLabel('入塾日',{exact:true}).fill('2026-10-20');await page.getByLabel('手続き日',{exact:true}).fill('2026-10-17');
 await page.getByLabel('詳しい記録（面談DBと生徒概要へ保存）').fill('手続きを実施。クラスは職員の判断待ち。');
 await expect(page.getByText('［この入塾手続きの記録へのリンク］ 詳細はこちら',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'保存して各所へ反映',exact:true}).click();await expect(page.getByRole('heading',{name:'保存結果：人の確認待ち'})).toBeVisible();
 expect(submitted).not.toBeNull();const sent=submitted as unknown as {payload:ReturnType<typeof model>['payload']};
 expect(sent.payload.fields.admissionDate.value).toBe('2026-10-20');expect(sent.payload.fields.procedureDate.value).toBe('2026-10-17');expect(sent.payload.fields.classes.state).toBe('unknown');
 await expect(page.getByText('クラスを判断してください。',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`analysis_outputs/enrollment/enrollment-${width}.png`,fullPage:true});
});
test('保存失敗で入力を保持し、同じ保存内容の再送に同じ操作番号を使う',async({page})=>{
 const context=model(),keys:string[]=[];
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/enrollment*',r=>{const u=new URL(r.request().url());if(r.request().method()==='POST'){keys.push(r.request().postDataJSON().operationKey);return r.fulfill({status:503,json:{error:'通信できませんでした。'}});}if(u.searchParams.has('q'))return r.fulfill({json:{students:[{id,name:'見本の生徒'}]}});if(u.searchParams.has('student'))return r.fulfill({json:context});if(u.searchParams.has('history'))return r.fulfill({json:{history:[]}});return r.fulfill({json:{entries:[]}});});
 await page.goto('/staff/enrollment');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を検索',exact:true}).click();await page.getByRole('button',{name:/見本の生徒 ／/}).click();
 await page.getByLabel('入塾日',{exact:true}).fill('2026-10-20');await page.getByRole('button',{name:'保存して各所へ反映',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('通信できません');await expect(page.getByLabel('入塾日',{exact:true})).toHaveValue('2026-10-20');
 await page.getByRole('button',{name:'保存して各所へ反映',exact:true}).click();await expect.poll(()=>keys.length).toBe(2);expect(keys[0]).toBe(keys[1]);
});
test('AI候補で明示入力を上書きせず、不明な候補は人の確認待ちに残す',async({page})=>{
 const context=model();
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));await page.route('**/api/staff/enrollment*',r=>{const u=new URL(r.request().url());if(r.request().method()==='POST')return r.fulfill({json:{record:'候補の文章',fields:{admissionDate:{value:'2026-10-01',state:'review',reason:'候補',source:'原文',candidates:[]},classes:{value:'２Ａ英',state:'review',reason:'確認してください',source:'英語を受講',candidates:[]}}}});if(u.searchParams.has('q'))return r.fulfill({json:{students:[{id,name:'見本の生徒'}]}});if(u.searchParams.has('student'))return r.fulfill({json:context});if(u.searchParams.has('history'))return r.fulfill({json:{history:[]}});return r.fulfill({json:{entries:[]}});});
 await page.goto('/staff/enrollment');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を検索',exact:true}).click();await page.getByRole('button',{name:/見本の生徒 ／/}).click();
 await page.getByLabel('入塾日',{exact:true}).fill('2026-10-20');await page.getByLabel('面談の内容・補足',{exact:true}).fill('英語を受講');await page.getByRole('button',{name:'AIで記録と入力候補を作る',exact:true}).click();
 await expect(page.getByLabel('入塾日',{exact:true})).toHaveValue('2026-10-20');await expect(page.locator('#state-classes')).toHaveValue('review');await expect(page.getByLabel('詳しい記録（面談DBと生徒概要へ保存）')).toHaveValue('');await page.getByRole('button',{name:'この文章を記録に使用する'}).click();await expect(page.getByLabel('詳しい記録（面談DBと生徒概要へ保存）')).toHaveValue('候補の文章');
});
test('権限のない職員へ個人情報の取得を開始しない',async({page})=>{
 let requests=0;await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{...staff,staffCode:'OTHER',role:'teacher'}}}));await page.route('**/api/staff/enrollment*',r=>{requests++;return r.fulfill({status:403,json:{error:'denied'}});});await page.goto('/staff/enrollment');await expect(page.getByText('この機能は、入塾手続きの入力権限を持つ職員が利用できます。')).toBeVisible();expect(requests).toBe(0);
});
test('未認証・別サイトからの保存・無認証cronをAPIが拒否する',async({request})=>{
 expect((await request.get('/api/staff/enrollment')).status()).toBe(401);
 expect((await request.post('/api/staff/enrollment',{headers:{Origin:'https://other.invalid'},data:{action:'save'}})).status()).toBe(403);
 expect((await request.get('/api/cron/enrollment-sync')).status()).toBe(401);
});
test('ログイン切れの入力を隠して保持し、同じ職員の再ログインで復元する',async({page})=>{
 const context=model();await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/enrollment*',r=>{const u=new URL(r.request().url());if(r.request().method()==='POST')return r.fulfill({status:401,json:{error:'ログインし直してください。'}});if(u.searchParams.has('q'))return r.fulfill({json:{students:[{id,name:'見本の生徒'}]}});if(u.searchParams.has('student'))return r.fulfill({json:context});if(u.searchParams.has('history'))return r.fulfill({json:{history:[]}});return r.fulfill({json:{entries:[]}});});
 await page.goto('/staff/enrollment');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を検索',exact:true}).click();await page.getByRole('button',{name:/見本の生徒 ／/}).click();await page.getByLabel('入塾日',{exact:true}).fill('2026-10-20');await page.getByRole('button',{name:'保存して各所へ反映',exact:true}).click();await expect(page.getByRole('heading',{name:'職員ログイン'})).toBeVisible();await expect(page.getByLabel('入塾日',{exact:true})).toHaveCount(0);await page.getByLabel('パスワード',{exact:true}).fill('test-only');await page.getByRole('button',{name:'ログイン',exact:true}).click();await expect(page.getByLabel('入塾日',{exact:true})).toHaveValue('2026-10-20');
});

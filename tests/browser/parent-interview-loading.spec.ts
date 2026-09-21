import {test,expect} from '@playwright/test';
const state={students:[{id:'student',name:'確認用生徒',teacher:'工藤'}],slots:[],invitationOnly:true,invitations:[{id:'invite',studentId:'student',version:1,expiresAt:'2030-01-02T03:00:00Z'}],requests:[{id:'request',studentId:'student',status:'approved',version:2,choices:[],note:'',reason:'',confirmed:{date:'2030-01-03',start:'13:00',end:'13:45',status:'confirmed'}}]};
test('日程取得が終わる前に確定予約を表示し、日程取得失敗でも予約を残して再試行できる',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let reads=0;
 await page.route('**/api/staff/interview-live-preview*',async r=>{
  if(r.request().url().includes('availability=1')){reads++;if(reads===1){await pending;await r.fulfill({status:503,json:{error:'Notion unavailable'}});}else await r.fulfill({json:{...state,slots:[{id:'slot',studentId:'student',date:'2030-01-03',start:'14:00',end:'14:45'}]}});}
  else await r.fulfill({json:{...state,slotsPending:true}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/interviews/trial');await expect(page.getByText('予約確定',{exact:true})).toBeVisible();await expect(page.getByText('日程を読み込んでいます…',{exact:true})).toBeVisible();await expect(page.getByText('現在、受付中の日程はありません。')).toHaveCount(0);
 release();await expect(page.locator('main').getByRole('alert')).toContainText('日程を読み込めませんでした');await expect(page.getByText('予約確定',{exact:true})).toBeVisible();await page.getByRole('button',{name:'日程をもう一度読み込む'}).click();await expect(page.getByRole('button',{name:/14:00/})).toBeVisible();await expect(page.locator('main').getByRole('alert')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('終了後に遅れた日程取得が戻っても生徒名と予約を再表示しない',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let started=false;
 await page.route('**/api/staff/session',r=>r.fulfill({json:{loggedOut:true}}));
 await page.route('**/api/staff/interview-live-preview*',async r=>{if(r.request().url().includes('availability=1')){started=true;await pending;await r.fulfill({json:state}).catch(()=>{});}else await r.fulfill({json:{...state,slotsPending:true}})});
 await page.goto('/interviews/trial');await expect(page.getByText('予約確定',{exact:true})).toBeVisible();await expect.poll(()=>started).toBe(true);await page.getByRole('button',{name:'終了する',exact:true}).click();await expect(page.getByText('LINEの個別メニューから開き直してください。')).toBeVisible();release();await expect(page.getByText('予約確定',{exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'確認用生徒さんの面談',exact:true})).toHaveCount(0);
});
test('遅れた日程応答で取消結果を上書きしない',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let withdrawn=false,started=false;
 await page.route('**/api/staff/interview-live-preview*',async r=>{if(r.request().method()==='POST'){withdrawn=true;return r.fulfill({json:{saved:true}})}if(r.request().url().includes('availability=1')){started=true;await pending;return r.fulfill({json:state}).catch(()=>{})}return r.fulfill({json:withdrawn?{...state,requests:[],invitations:[],slotsPending:false}:{...state,slotsPending:true}})});
 await page.goto('/interviews/trial');await expect(page.getByText('予約確定',{exact:true})).toBeVisible();await expect.poll(()=>started).toBe(true);page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'予約を取り消す'}).click();await expect(page.getByRole('status')).toContainText('予約を取り消しました');release();await expect(page.getByText('予約確定',{exact:true})).toHaveCount(0);
});
test('LINEの案内リンクを初回取得と日程取得の両方に引き継ぐ',async({page})=>{
 const invitation='00000000-0000-4000-8000-000000000123',urls:string[]=[];
 await page.route('**/api/staff/interview-live-preview*',r=>{const url=new URL(r.request().url());urls.push(url.href);return r.fulfill({json:url.searchParams.has('availability')?state:{...state,slotsPending:true}})});
 await page.goto('/interviews/trial?invitation='+invitation);await expect(page.getByText('予約確定',{exact:true})).toBeVisible();await expect.poll(()=>urls.length).toBe(2);expect(urls.every(url=>new URL(url).searchParams.get('invitation')===invitation)).toBe(true);
});

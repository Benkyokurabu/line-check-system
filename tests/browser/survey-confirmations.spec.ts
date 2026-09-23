import {test,expect, type BrowserContext} from '@playwright/test';
const id='11111111111141118111111111111111';
const url=`https://app.notion.com/p/${id}`;
const groups=[{teacher:'工藤',students:[{grade:'中3',name:'保存確認生徒',notionUrl:url,submittedAt:'2026-09-16T00:00:00Z'}]}];
type State={page_id:string;confirmed:boolean;version:number;updated_name?:string;updated_at?:string};
function server(){return {states:[] as State[],fail:false,conflict:false,unauthorized:false,delay:0,posts:0};}
async function setup(c:BrowserContext,s:ReturnType<typeof server>){
 await c.route('**/api/interview-surveys',r=>r.fulfill({json:{groups}}));
 await c.route('**/api/interview-surveys/confirmations',async r=>{
  if(s.unauthorized)return r.fulfill({status:401,json:{error:'ログインし直してください。'}});
  if(r.request().method()==='POST'){
   s.posts++;if(s.delay)await new Promise(resolve=>setTimeout(resolve,s.delay));
   if(s.fail)return r.fulfill({status:503,json:{error:'保存できませんでした。再試行してください。'}});
   if(s.conflict){s.conflict=false;s.states=[{page_id:id,confirmed:false,version:2}];return r.fulfill({status:409,json:{states:s.states}});}
   const change=r.request().postDataJSON().changes[0];
   s.states=[{page_id:change.pageId,confirmed:change.confirmed,version:change.version+1,updated_name:'工藤',updated_at:'2026-09-23T07:00:00Z'}];
   return r.fulfill({json:{saved:true,states:s.states}});
  }return r.fulfill({json:{states:s.states}});
 });
}
test('自動保存・画面復帰・再読込で共有し、開いたままでは定期取得しない',async({browser})=>{
 const s=server();const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 for(const c of contexts)await setup(c,s);
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 await a.clock.install();
 for(const p of [a,b]){await p.goto('/');await p.getByRole('button',{name:'工藤先生 1'}).click();await expect(p.getByRole('button',{name:'未確認',exact:true})).toBeEnabled();}
 s.delay=500;await a.getByRole('button',{name:'未確認',exact:true}).click();await expect(a.getByRole('button',{name:'保存中…'}).first()).toBeDisabled();
 await expect(a.getByRole('button',{name:'確認済み',exact:true})).toBeEnabled();await expect(a.getByText(/最終更新：工藤/)).toBeVisible();
 await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(b.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();
 await b.getByRole('button',{name:'確認済み',exact:true}).click();await expect(b.getByRole('button',{name:'未確認',exact:true})).toBeEnabled();
 let idleReads=0;a.on('request',r=>{if(r.method()==='GET'&&r.url().endsWith('/api/interview-surveys/confirmations'))idleReads++;});
 await a.clock.fastForward(120000);await expect(a.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();expect(idleReads).toBe(0);
 await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(a.getByRole('button',{name:'未確認',exact:true})).toBeVisible();
 await a.reload();await a.getByRole('button',{name:'工藤先生 1'}).click();await expect(a.getByRole('button',{name:'未確認',exact:true})).toBeVisible();expect(s.posts).toBe(2);
 await Promise.all(contexts.map(c=>c.close()));
});
test('保存失敗は確認済みにせず再試行、競合は共有と操作を比較してから反映',async({page,context})=>{
 const s=server();s.fail=true;await setup(context,s);await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();
 await page.getByRole('button',{name:'未確認',exact:true}).click();await expect(page.locator('p[role=alert]')).toContainText('保存できません');await expect(page.getByRole('button',{name:'未確認',exact:true})).toBeEnabled();
 s.fail=false;s.conflict=true;await page.getByRole('button',{name:'内容を確認して再試行'}).click();await expect(page.locator('p[role=alert]')).toContainText('他のPC');expect(s.posts).toBe(2);
 await page.getByRole('button',{name:'内容を確認して再試行'}).click();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeEnabled();expect(s.states[0].version).toBe(3);
});
test('共有記録がない旧端末記録を自動で引き継ぐ、スマホでも操作可能',async({page,context})=>{
 const s=server();await setup(context,s);await page.setViewportSize({width:390,height:844});await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();expect(s.posts).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('共有側に変更がある旧記録は自動で上書きしない',async({page,context})=>{
 const s=server();s.states=[{page_id:id,confirmed:false,version:2}];await setup(context,s);
 await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();await expect(page.getByRole('button',{name:'この端末の記録を共有'})).toBeEnabled();
 await expect(page.getByRole('button',{name:'未確認',exact:true})).toBeVisible();expect(s.posts).toBe(0);
});
test('ログイン切れで共有状態を偽装せず再ログイン後に復帰',async({page,context})=>{
 const s=server();await setup(context,s);await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();await expect(page.getByRole('button',{name:'未確認',exact:true})).toBeEnabled();
 s.unauthorized=true;await page.getByRole('button',{name:'未確認',exact:true}).click();await expect(page.getByRole('link',{name:'職員ログイン',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'未確認',exact:true})).toBeEnabled();
 s.unauthorized=false;await page.getByRole('button',{name:'確認状態を再取得'}).click();await expect(page.getByRole('button',{name:'内容を確認して再試行'})).toBeEnabled();
});
test('未認証の保存・他サイトからの保存を拒否',async({request})=>{
 expect((await request.post('/api/interview-surveys/confirmations',{headers:{origin:'https://other.invalid'},data:{changes:[]}})).status()).toBe(403);
 expect((await request.post('/api/interview-surveys/confirmations',{headers:{origin:'https://test.invalid'},data:{changes:[]}})).status()).toBe(401);
});

test('保存失敗した操作は再読込後も残り、自動では送信しない',async({page,context})=>{
 const s=server();s.fail=true;await setup(context,s);await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();await page.getByRole('button',{name:'未確認',exact:true}).click();await expect(page.locator('p[role=alert]')).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'工藤先生 1'}).click();await expect(page.getByRole('button',{name:'この端末の記録を共有'})).toBeEnabled();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();await expect(page.getByText('この端末の記録・共有待ち',{exact:true})).toBeVisible();expect(s.posts).toBe(1);
 s.fail=false;await page.getByRole('button',{name:'この端末の記録を共有'}).click();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();
});
test('取得失敗で前回の確認状態を未確認に戻さない',async({page,context})=>{
 const s=server();s.states=[{page_id:id,confirmed:true,version:1}];await setup(context,s);await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();
 await page.route('**/api/interview-surveys/confirmations',r=>r.fulfill({status:503,json:{error:'unavailable'}}));await page.getByRole('button',{name:'確認状態を再取得'}).click();await expect(page.getByText(/同期できません。前回の表示/)).toBeVisible();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();
});

test('共有への保存が未ログインでも旧端末の確認済み表示を維持し、原本を保全する',async({page,context})=>{
 const s=server();await setup(context,s);
 await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.route('**/api/interview-surveys/confirmations',r=>r.request().method()==='POST'?r.fulfill({status:401,json:{error:'ログインし直してください。'}}):r.fulfill({json:{states:[]}}));
 await page.goto('/');await page.getByRole('button',{name:'工藤先生 1'}).click();
 await expect(page.getByRole('button',{name:'確認済み',exact:true})).toBeEnabled();await expect(page.getByText('この端末の記録・共有待ち',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bentan:2026-autumn-survey-confirmed')||'[]').length)).toBe(1);
 expect(await page.evaluate(()=>!!localStorage.getItem('bentan:2026-autumn-survey-before-sharing'))).toBe(true);
});

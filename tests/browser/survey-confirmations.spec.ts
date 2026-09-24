import {test,expect, type BrowserContext} from '@playwright/test';
const id='11111111111141118111111111111111';
const id2='22222222222242228222222222222222';
const url=`https://app.notion.com/p/${id}`;
const groups=[{teacher:'工藤',students:[{grade:'中3',name:'保存確認生徒',notionUrl:url,submittedAt:'2026-09-16T00:00:00Z'},{grade:'中1',name:'並行保存生徒',notionUrl:`https://app.notion.com/p/${id2}`,submittedAt:'2026-09-16T01:00:00Z'}]}];
type State={page_id:string;confirmed:boolean;progress_status?:string;version:number;updated_name?:string;updated_at?:string};
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
   const saved={page_id:change.pageId,confirmed:change.progress!=='needs-review',progress_status:change.progress,version:change.version+1,updated_name:'工藤',updated_at:'2026-09-23T07:00:00Z'};
   s.states=[...s.states.filter(state=>state.page_id!==change.pageId),saved];
   return r.fulfill({json:{saved:true,states:[saved],partial:true}});
  }return r.fulfill({json:{states:s.states}});
 });
}
test('自動保存・画面復帰・再読込で共有し、開いたままでは定期取得しない',async({browser})=>{
 const s=server();const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 for(const c of contexts)await setup(c,s);
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 await a.clock.install();
 for(const p of [a,b]){await p.goto('/');await p.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(p.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');}
 s.delay=500;await a.getByRole('combobox',{name:'保存確認生徒の対応状況'}).selectOption('coordinating');await expect(a.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toBeDisabled();
 await expect(a.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('coordinating');await expect(a.getByText(/最終更新：/)).toBeVisible();
 await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(b.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('coordinating');
 await b.getByRole('combobox',{name:'保存確認生徒の対応状況'}).selectOption('needs-review');await expect(b.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');await expect(b.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toBeEnabled();
 let idleReads=0;a.on('request',r=>{if(r.method()==='GET'&&r.url().endsWith('/api/interview-surveys/confirmations'))idleReads++;});
 await a.clock.fastForward(120000);await expect(a.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('coordinating');expect(idleReads).toBe(0);
 await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(a.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');
 await a.reload();await a.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(a.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');expect(s.posts).toBe(2);
 await Promise.all(contexts.map(c=>c.close()));
});
test('選択直後に表示を切り替え、操作した行だけを並行保存する',async({page,context})=>{
 const s=server();s.delay=500;await setup(context,s);await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');
 const first=page.getByRole('combobox',{name:'保存確認生徒の対応状況'}),second=page.getByRole('combobox',{name:'並行保存生徒の対応状況'});
 await first.selectOption('coordinating');await expect(first).toHaveValue('coordinating');await expect(first).toBeDisabled();await expect(second).toBeEnabled();
 await second.selectOption('scheduled');await expect(second).toHaveValue('scheduled');await expect(second).toBeDisabled();
 await expect(first).toBeEnabled();await expect(second).toBeEnabled();await expect(first).toHaveValue('coordinating');await expect(second).toHaveValue('scheduled');expect(s.posts).toBe(2);
});
test('保存失敗は対応済みにせず再試行、競合は共有と操作を比較してから反映',async({page,context})=>{
 const s=server();s.fail=true;await setup(context,s);await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');
 await page.getByRole('combobox',{name:'保存確認生徒の対応状況'}).selectOption('completed');await expect(page.locator('p[role=alert]')).toContainText('保存できません');await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');
 s.fail=false;s.conflict=true;await page.getByRole('button',{name:'内容を確認して再試行'}).click();await expect(page.locator('p[role=alert]')).toContainText('他のPC');expect(s.posts).toBe(2);
 await page.getByRole('button',{name:'内容を確認して再試行'}).click();await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('completed');expect(s.states[0].version).toBe(3);
});
test('共有記録がない旧端末記録を自動で引き継ぐ、スマホでも操作可能',async({page,context})=>{
 const s=server();await setup(context,s);await page.setViewportSize({width:390,height:844});await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('handled');await expect.poll(()=>s.posts).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('共有側に変更がある旧記録は自動で上書きしない',async({page,context})=>{
 const s=server();s.states=[{page_id:id,confirmed:false,version:2}];await setup(context,s);
 await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(page.getByRole('button',{name:'この端末の記録を共有'})).toBeEnabled();
 await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');expect(s.posts).toBe(0);
});
test('ログイン切れで共有状態を偽装せず再ログイン後に復帰',async({page,context})=>{
 const s=server();await setup(context,s);await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');
 s.unauthorized=true;await page.getByRole('combobox',{name:'保存確認生徒の対応状況'}).selectOption('handled');await expect(page.getByRole('link',{name:'職員ログイン',exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('needs-review');
 s.unauthorized=false;await page.getByRole('button',{name:'一覧を最新に更新'}).click();await expect(page.getByRole('button',{name:'内容を確認して再試行'})).toBeEnabled();
});
test('ログインを要求せず入力検証し、他サイトからの保存を拒否',async({request})=>{
 expect((await request.post('/api/interview-surveys/confirmations',{headers:{origin:'https://other.invalid'},data:{changes:[]}})).status()).toBe(403);
 expect((await request.post('/api/interview-surveys/confirmations',{headers:{origin:'https://test.invalid'},data:{clientVersion:2,changes:[]}})).status()).toBe(400);
});

test('保存失敗した操作は再読込後も残り、自動では送信しない',async({page,context})=>{
 const s=server();s.fail=true;await setup(context,s);await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await page.getByRole('combobox',{name:'保存確認生徒の対応状況'}).selectOption('scheduled');await expect(page.locator('p[role=alert]')).toBeVisible();
 await page.reload();await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(page.getByRole('button',{name:'この端末の記録を共有'})).toBeEnabled();await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('scheduled');await expect(page.getByText('この端末の記録・共有待ち',{exact:true})).toBeVisible();expect(s.posts).toBe(1);
 s.fail=false;await page.getByRole('button',{name:'この端末の記録を共有'}).click();await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('scheduled');
});
test('取得失敗で前回の対応状況を未対応に戻さない',async({page,context})=>{
 const s=server();s.states=[{page_id:id,confirmed:true,progress_status:'completed',version:1}];await setup(context,s);await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('completed');
 await page.route('**/api/interview-surveys/confirmations',r=>r.fulfill({status:503,json:{error:'unavailable'}}));await page.getByRole('button',{name:'一覧を最新に更新'}).click();await expect(page.getByText(/同期できません。前回の表示/)).toBeVisible();await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('completed');
});

test('共有への保存が未ログインでも旧端末の対応済み表示を維持し、原本を保全する',async({page,context})=>{
 const s=server();await setup(context,s);
 await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.route('**/api/interview-surveys/confirmations',r=>r.request().method()==='POST'?r.fulfill({status:401,json:{error:'ログインし直してください。'}}):r.fulfill({json:{states:[]}}));
 await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');
 await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('handled');await expect(page.getByText('この端末の記録・共有待ち',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bentan:2026-autumn-survey-confirmed')||'[]').length)).toBe(1);
 expect(await page.evaluate(()=>!!localStorage.getItem('bentan:2026-autumn-survey-before-sharing'))).toBe(true);
});

test('同じ記録が共有済みなら旧端末の共有待ち表示を自動解消する',async({page,context})=>{
 const s=server();s.states=[{page_id:id,confirmed:true,version:1}];await setup(context,s);
 await page.addInitScript(u=>localStorage.setItem('bentan:2026-autumn-survey-confirmed',JSON.stringify([u])),url);
 await page.goto('/');await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');await expect(page.getByRole('combobox',{name:'保存確認生徒の対応状況'})).toHaveValue('handled');
 await expect(page.getByRole('button',{name:'この端末の記録を共有'})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('bentan:2026-autumn-survey-drafts-v1')||'{}')).length)).toBe(0);expect(s.posts).toBe(0);
});

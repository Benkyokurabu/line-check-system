import {test,expect} from '@playwright/test';
const slots=Array.from({length:6},(_,n)=>({id:`preview-${n}`,date:`2030-01-0${2+Math.floor(n/2)}`,start:n%2?'14:00':'13:00',end:n%2?'14:45':'13:45',campus:'本校',available:true}));
test('LINE個別入口から本番確認用の申請を送り、通常申請と同じ形で取り下げる',async({page})=>{
 let row:Record<string,unknown>|null=null;const writes:Record<string,unknown>[]=[];const unexpected:string[]=[];
 await page.route('**/api/**',route=>{unexpected.push(route.request().url());return route.abort();});
 await page.route('**/api/staff/entry',route=>{expect(route.request().postDataJSON().destination).toBe('studentPreview');return route.fulfill({json:{destination:'/interviews/trial?staff=KUDO'}});});
 await page.route('**/api/staff/interview-live-preview',async route=>{
  if(route.request().method()==='POST'){
   const op=route.request().postDataJSON();writes.push(op);
   await new Promise(resolve=>setTimeout(resolve,150));
   if(op.action==='submit')row={id:'row',studentId:'preview',status:'pending',version:1,choices:op.choices.map((id:string)=>({slotId:id,...slots.find(s=>s.id===id)})),confirmed:null,note:op.note,reason:''};
   else {expect(op.action).toBe('withdraw');row={...row,status:'cancelled',version:2};}
   return route.fulfill({json:{saved:true}});
  }
  return route.fulfill({json:{students:[{id:'preview',name:'工藤（確認用生徒）'}],slots:slots.map(slot=>({...slot,studentId:'preview'})),requests:[...(row?[row]:[])]}});
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('/staff/entry#key='+'x'.repeat(43)+'&to=studentPreview');
 await expect(page).toHaveURL(/\/interviews\/trial\?staff=KUDO$/);
 await expect(page.getByText(/本番と同じ申請・先生承認・Notion登録/)).toBeVisible();
 await expect(page.locator('body')).not.toContainText('勉たん');
 await expect(page.getByRole('navigation')).toHaveCount(0);await expect(page.getByText('Codexに依頼')).toHaveCount(0);
 await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByLabel('パスワード')).toHaveCount(0);
 for(let i=0;i<3;i++)await page.locator('button[aria-pressed]').nth(i).click();
 await expect(page.locator('button[aria-pressed]').nth(3)).toBeDisabled();
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await page.getByRole('button',{name:'← 戻る',exact:true}).click();
 expect(await page.locator('button[aria-pressed=true]').count()).toBe(3);
 await page.screenshot({path:'analysis_outputs/parent-interviews/student-preview.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await page.getByRole('button',{name:'予約希望を送信する',exact:true}).click();
 await expect(page.getByRole('button',{name:'送信中…',exact:true})).toBeVisible();
 await expect(page.getByText('承認待ち',{exact:true}).last()).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 expect(writes[0].choices).toEqual(slots.slice(0,3).map(s=>s.id));expect(writes[0].studentId).toBe('preview');
 await page.getByRole('button',{name:'状況を更新する'}).click();await expect(page.getByText('最新の状況に更新しました。')).toBeVisible();
 await page.getByRole('button',{name:'申請を取り下げる'}).last().click();await page.getByRole('button',{name:'取り下げる',exact:true}).click();
 await expect(page.getByText('申請を取り下げました。')).toBeVisible();expect(writes).toHaveLength(2);expect(writes[1].id).toBe('row');
 expect(unexpected.filter(url=>!url.includes('/api/app-version'))).toEqual([]);
});
test('生徒役セッションがなければ個別LINEメニューへ案内する',async({page})=>{
 await page.route('**/api/staff/interview-live-preview',r=>r.fulfill({status:401,json:{error:'ログインしてください'}}));
 await page.goto('/interviews/trial');await expect(page.getByText('LINEの個別メニューから開き直してください。')).toBeVisible();
 await expect(page.getByRole('link',{name:'LINEで続ける'})).toHaveCount(0);await expect(page.getByLabel('パスワード')).toHaveCount(0);
});

test('生徒・保護者の入口と予約画面には内部のアプリ名を表示しない',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({status:401,json:{error:'ログインしてください',loginAvailable:false}}));
 for(const path of ['/staff/entry','/interviews','/interviews/trial','/self-study-room/trial','/reservations/trial']){
  await page.goto(path);
  await expect(page.locator('body')).not.toContainText('勉たん');
  expect(await page.title()).not.toContain('勉たん');
  await expect(page.locator('meta[name="application-name"]')).not.toHaveAttribute('content',/勉たん/);
  await expect(page.getByRole('navigation',{name:'業務ナビゲーション'})).toHaveCount(0);
 }
});

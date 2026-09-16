import {test,expect} from '@playwright/test';
const slots=Array.from({length:6},(_,n)=>({id:`preview-${n}`,date:`2030-01-0${2+Math.floor(n/2)}`,start:n%2?'14:00':'13:00',end:n%2?'14:45':'13:45',campus:'本校',available:true}));
test('LINE個別入口から生徒役になり、第3希望の保存・取り下げを検証データだけで行う',async({page})=>{
 let row:Record<string,unknown>|null=null;const writes:Record<string,unknown>[]=[];const unexpected:string[]=[];
 await page.route('**/api/**',route=>{if(new URL(route.request().url()).pathname==='/api/codex'&&!page.url().includes('/interviews/trial'))return route.fulfill({status:401,json:{error:'Unauthorized'}});unexpected.push(route.request().url());return route.abort();});
 await page.route('**/api/staff/entry',route=>{expect(route.request().postDataJSON().destination).toBe('studentPreview');return route.fulfill({json:{destination:'/interviews/trial?staff=KUDO'}});});
 await page.route('**/api/staff/interview-trial/student',route=>{
  if(route.request().method()==='POST'){
   const op=route.request().postDataJSON();writes.push(op);
   if(op.action==='submit')row={id:'row',status:'pending',version:1,choices:op.choices.map((id:string)=>slots.find(s=>s.id===id)),confirmed:null,details:{note:op.note}};
   else {expect(op.action).toBe('cancel');row={...row,status:'cancelled',version:2};}
   return route.fulfill({json:{saved:true}});
  }
  return route.fulfill({json:{studentName:'工藤（確認用生徒）',slots,requests:row?[row]:[]}});
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('/staff/entry#key='+'x'.repeat(43)+'&to=studentPreview');
 await expect(page).toHaveURL(/\/interviews\/trial\?staff=KUDO$/);
 await expect(page.getByText(/生徒役の検証用です/)).toBeVisible();
 await expect(page.getByRole('navigation')).toHaveCount(0);await expect(page.getByText('Codexに依頼')).toHaveCount(0);
 await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByLabel('パスワード')).toHaveCount(0);
 for(let i=0;i<3;i++)await page.locator('button[aria-pressed]').nth(i).click();
 await expect(page.locator('button[aria-pressed]').nth(3)).toBeDisabled();
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await page.getByRole('button',{name:'← 戻る',exact:true}).click();
 expect(await page.locator('button[aria-pressed=true]').count()).toBe(3);
 await page.screenshot({path:'analysis_outputs/parent-interviews/student-preview.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await page.getByRole('button',{name:'予約希望を送信する',exact:true}).click();
 await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();
 expect(writes[0].method).toBe('Zoom');expect(writes[0].choices).toEqual(slots.slice(0,3).map(s=>s.id));expect(writes[0]).not.toHaveProperty('studentId');
 await page.getByRole('button',{name:'申請を取り下げる'}).click();await page.getByRole('button',{name:'取り下げる',exact:true}).click();
 await expect(page.getByText('申請を取り下げました。')).toBeVisible();expect(writes).toHaveLength(2);
 expect(unexpected.filter(url=>!url.includes('/api/app-version'))).toEqual([]);
});
test('生徒役セッションがなければ個別LINEメニューへ案内する',async({page})=>{
 await page.route('**/api/staff/interview-trial/student',r=>r.fulfill({status:401,json:{error:'ログインしてください'}}));
 await page.goto('/interviews/trial');await expect(page.getByText('LINEの個別メニューから開き直してください。')).toBeVisible();
 await expect(page.getByRole('link',{name:'LINEで続ける'})).toHaveCount(0);await expect(page.getByLabel('パスワード')).toHaveCount(0);
});

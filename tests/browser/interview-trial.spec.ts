import {test,expect,type Page} from '@playwright/test';
import {readInterviewTrial,changeInterviewTrial,trialDay} from '../../src/lib/interview-trial.mjs';
const actor=(code:string)=>({staffId:code,staffCode:code,role:'admin',displayName:code==='KUDO'?'工藤':'金城'});
test('生徒役のメニューから面談申請し、職員の承認と取消を双方で確認する',async({page,context})=>{
 let saved={rows:[],operations:[],events:[]};let writes=0;
 async function install(target:Page,code:string){
  await target.route('**/api/staff/session',route=>route.fulfill({json:{staff:actor(code)}}));
  await target.route('**/api/staff/interview-trial/*',route=>{
   const view=route.request().url().split('/').at(-1)!;
   if(route.request().method()==='GET')return route.fulfill({json:readInterviewTrial(saved,actor(code),view)});
   try{const changed=changeInterviewTrial(saved,actor(code),view,route.request().postDataJSON());saved=changed.state;writes++;return route.fulfill({json:changed.result});}
   catch(e){return route.fulfill({status:(e as {status:number}).status,json:{error:(e as Error).message}});}
  });
 }
 await page.setViewportSize({width:390,height:844});await install(page,'KUDO');
 await page.goto('/reservations/trial?staff=KUDO');
 await expect(page.getByRole('link',{name:/自習室予約/})).toBeVisible();await page.getByRole('link',{name:/面談予約/}).click();
 await expect(page.getByRole('heading',{name:'面談を申し込む'})).toBeVisible();await expect(page.getByRole('navigation',{name:'業務ナビゲーション'})).toHaveCount(0);
 await page.getByLabel('第1希望の時間').selectOption(`${trialDay(3)}|本校|13:00`);
 await page.getByLabel('第2希望の時間').selectOption(`${trialDay(4)}|本校|14:00`);
 await page.getByRole('button',{name:'申請内容を確認'}).click();expect(writes).toBe(0);
 await page.getByRole('button',{name:'この内容で進める'}).click();
 const studentRow=page.getByRole('article',{name:'工藤（確認用生徒）の面談'});await expect(studentRow).toContainText('承認待ち');
 const office=await context.newPage();await install(office,'KINJO');await office.goto('/reservations/trial?staff=KINJO&kind=interview');
 await expect(office.getByText('まだ申請はありません。')).toBeVisible();
 await office.goto('/staff/interviews/trial');const staffRow=office.getByRole('article',{name:'工藤（確認用生徒）の面談'});
 await staffRow.getByLabel('確定する希望日時').selectOption(`${trialDay(4)}|本校|14:00`);
 await staffRow.getByRole('button',{name:'承認して確定'}).click();await office.getByRole('button',{name:'この内容で進める'}).click();
 await expect(studentRow).toContainText('予約確定',{timeout:10000});await expect(studentRow).toContainText(`確定した日時：${trialDay(4)} 14:00`);
 await studentRow.getByLabel('取消理由').fill('確認用の取消');await studentRow.getByRole('button',{name:'予約の取消を申請'}).click();await page.getByRole('button',{name:'この内容で進める'}).click();
 await expect(studentRow).toContainText('現在の予約は確保されています');
 await expect(staffRow).toContainText('取消申請中',{timeout:10000});await staffRow.getByRole('button',{name:'取消を承認'}).click();await office.getByRole('button',{name:'この内容で進める'}).click();
 await expect(studentRow).toContainText('取消済み',{timeout:10000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('未認証・対象外の人には統合予約メニューも申請データも見せない',async({page})=>{
 await page.route('**/api/staff/session',route=>route.fulfill({status:401,json:{error:'ログインしてください。'}}));
 await page.goto('/reservations/trial?staff=KUDO');await expect(page.getByLabel('パスワード')).toBeVisible();
 await expect(page.getByRole('link',{name:/面談予約/})).toHaveCount(0);
 await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:actor('OTHER')}}));
 await page.reload();await expect(page.getByRole('status')).toContainText('工藤さん・金城さんだけ');
 await expect(page.getByRole('link',{name:/自習室予約/})).toHaveCount(0);
});

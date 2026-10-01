import {test,expect} from '@playwright/test';

test('mobile survey workflow saves the date and previews only checked LINE recipients',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 let date='',recordBody='',sendCalls=0;
 const accounts=[
  {id:'line-mother',relation:'mother',label:'母・確認済み'},
  {id:'line-father',relation:'father',label:'父・確認済み'},
  {id:'line-student',relation:'student',label:'本人・確認済み'},
 ];
 await page.route('**/api/staff/survey-workflow?answer=*',async route=>{
  await route.fulfill({json:{student:{name:'山田 花',number:'2019001',grade:'中2'},staffName:'工藤',
   survey:{id:'11111111-1111-4111-8111-111111111111',url:'https://example.invalid/survey',date,editedAt:'2026-10-01T00:00:00Z'},
   accounts,record:date?{id:recordBody?'record-1':'',url:'',body:recordBody,blockId:recordBody?'block-1':'',
    blockEditedAt:recordBody?'2026-10-01T00:00:00Z':'',editable:true}:null}});
 });
 await page.route('**/api/staff/survey-workflow',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='date'){date=body.date;await route.fulfill({json:{ok:true,date}});return;}
  if(body.action==='record'){recordBody=body.content;await route.fulfill({json:{ok:true,recordId:'record-1'}});return;}
  if(body.action==='send'){sendCalls++;await route.fulfill({json:{results:body.messages.map((m:{lineUserId:string})=>({lineUserId:m.lineUserId,status:'sent'}))}});return;}
  await route.fulfill({status:400,json:{error:'Unknown action'}});
 });
 await page.goto('/staff/survey-workflow?answer=11111111-1111-4111-8111-111111111111');
 await expect(page.getByRole('heading',{name:'アンケートから面談を進める'})).toBeVisible();
 await page.getByLabel('面談日').fill('2026-10-01');
 await page.getByRole('button',{name:'面談日を保存'}).click();
 await expect(page.getByText('面談日をアンケートのNotion原本に保存しました。')).toBeVisible();
 const schedule=page.getByRole('heading',{name:'2　日程をLINEで連絡する'}).locator('..');
 await schedule.getByLabel(/母・確認済み/).check();
 await schedule.getByLabel(/本人・確認済み/).check();
 await schedule.getByLabel('日程連絡の文面').fill('10月1日18時から面談をお願いします。');
 await schedule.getByRole('button',{name:'宛先・文面を確認'}).click();
 await expect(schedule.getByText('父・確認済み')).toHaveCount(1);
 await expect(schedule.getByRole('heading',{name:'日程連絡の送信確認'})).toBeVisible();
 await schedule.getByRole('button',{name:'表示した宛先へLINE送信'}).click();
 await expect.poll(()=>sendCalls).toBe(1);
 await page.getByLabel('面談内容').fill('志望校について\n復習を進めましょう。');
 await page.getByRole('button',{name:'面談記録を作成'}).click();
 await expect(page.getByText('面談内容をNotionの面談記録に保存しました。')).toBeVisible();
 const summary=page.getByRole('heading',{name:'4　面談後のまとめをLINEで送る'}).locator('..');
 await summary.getByLabel(/父・確認済み/).check();
 await summary.getByLabel(/母・確認済み/).check();
 await expect(summary.getByLabel('父・確認済みへの文面')).toContainText('志望校について');
 await summary.getByRole('button',{name:'宛先・文面を確認'}).click();
 await expect(summary.getByRole('heading',{name:'面談後のまとめの送信確認'})).toBeVisible();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 expect(overflow).toBe(false);
});

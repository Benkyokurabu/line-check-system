import {test,expect} from '@playwright/test';
for(const width of [1280,390])test(`日程確定文を挨拶から結びまで一括生成して編集できる ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});let sends=0;
 const id='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill({json:{student:{name:'見本の生徒',number:'2026000',grade:'中2'},staffName:'工藤謙',staffCode:'KUDO',survey:{id,date:'2026-10-24',time:'14:00',editedAt:'v1'},bensuke:{state:'synced',method:'３者Zoom',endTime:'14:45',styled:true},accounts:[],record:null}}));
 await page.route('**/api/staff/survey-workflow',r=>{sends++;return r.fulfill({json:{ok:true}});});
 await page.goto(`/staff/survey-workflow?answer=${id}`);
 await page.getByRole('button',{name:'日程から文面を作る',exact:true}).click();
 const message=page.getByLabel('日程連絡の文面');
 await expect(message).toHaveValue('こんにちは。工藤です。\nご連絡ありがとうございます。\n\n面談を以下の日時で確定させていただきたいと思います。\n\n10月24日（土）14:00〜14:45\n\nIDとパスコードは当日お伝えいたします。\nそれではよろしくお願いいたします。');
 await message.fill((await message.inputValue())+'\n追記');await expect(message).toHaveValue(/お願いいたします。\n追記$/);
 expect(sends).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`analysis_outputs/post-interview/schedule-message-${width}.png`,fullPage:true});
});

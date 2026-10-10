import {expect,test,type Page} from '@playwright/test';

const answer='11111111-1111-4111-8111-111111111111';
const compact=answer.replaceAll('-','');
const list='/staff/surveys/2026-autumn';
const openerName='架空 花子：日程連絡・面談記録・LINE';
const completeName='登録を完了して元の一覧へ戻る';
async function fixture(page:Page,options:{pause?:boolean;fail?:boolean;lostResponse?:boolean;failRefresh?:boolean}={}){
 let saved=false,date='',time='',endTime='',method='３者Zoom',attempts=0,created=0;
 const writes:string[]=[];
 let release!:()=>void,started!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve;});
 const began=new Promise<void>(resolve=>{started=resolve;});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(req.method()!=='GET'){
   const body=req.postDataJSON();writes.push(`${path}:${body.action??'unknown'}`);
   if(path!=='/api/staff/survey-workflow'||body.action!=='date')return route.fulfill({status:403,json:{error:'実送信・資料作成・記録保存は禁止'}});
   attempts++;started();if(options.pause)await hold;
   if(options.fail&&attempts===1)return route.fulfill({status:503,json:{error:'保存に失敗しました。入力を確認して再試行してください。'}});
   if(!saved)created++;saved=true;date=body.date;time=body.time;endTime=body.endTime;method=body.method;
   if(options.lostResponse&&attempts===1)return route.fulfill({status:503,json:{error:'保存結果を確認できません。最新情報を読み直してください。'}});
   return route.fulfill({json:{ok:true,bensuke:{state:'synced',id:'one-schedule',endTime,method,styled:true}}});
  }
  if(path==='/api/staff/survey-workflow'){
   if(saved&&options.failRefresh)return route.fulfill({status:503,json:{error:'表示の取得に失敗しました。'}});
   return route.fulfill({json:{student:{name:'架空 花子',number:'2019001',grade:'中2'},staffName:'工藤',scheduleTeacher:'工藤',
    survey:{id:answer,url:'https://example.invalid/survey',date,time,editedAt:saved?'v2':'v1'},
    bensuke:{state:saved?'synced':'new',id:saved?'one-schedule':undefined,endTime,method,styled:true},accounts:[],record:null}});
  }
  if(path==='/api/interview-surveys')return route.fulfill({json:{groups:[{teacher:'工藤',students:[{name:'架空 花子',grade:'中2',notionUrl:`https://www.notion.so/${compact}`,submittedAt:'2026-10-01T00:00:00Z'}]}]}});
  if(path==='/api/interview-surveys/confirmations')return route.fulfill({json:{states:[]}});
  if(path==='/api/interview-surveys/scheduling')return route.fulfill({json:{states:{[compact]:saved?{status:'confirmed',detail:'日程が確定しています。',date,start:time,end:endTime}:{status:'uncontacted',detail:'未連絡'}},updatedAt:'2026-10-01T00:00:00Z'}});
  return route.fulfill({json:{}});
 });
 return {writes,release,began,get attempts(){return attempts;},get created(){return created;}};
}
async function open(page:Page,progress=''){
 await page.goto(list);
 await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).fill('架空');
 await page.getByRole('combobox',{name:'アンケートの担任'}).selectOption('工藤');
 if(progress)await page.getByRole('combobox',{name:'アンケートの進捗'}).selectOption(progress);
 await page.getByRole('button',{name:openerName}).click();
 return page.getByRole('region',{name:'面談入力'});
}

for(const width of [1280,390])test(`date registration alone completes, preserves list filters and reopens without a second save (${width}px)`,async({page})=>{
 await page.setViewportSize({width,height:844});const state=await fixture(page,{pause:true});const ui=await open(page);
 await ui.getByLabel('面談日',{exact:true}).fill('2099-10-03');await ui.getByLabel('開始時刻（任意）').fill('18:00');
 await ui.getByRole('button',{name:'面談日を保存',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await state.began;await expect(ui.getByRole('button',{name:'アンケートの回答一覧に戻る'})).toBeDisabled();
 await expect(page.getByRole('button',{name:openerName})).toBeDisabled();
 await expect(page.getByRole('searchbox',{name:'アンケートの生徒を検索'})).toBeDisabled();expect(state.attempts).toBe(1);
 state.release();await expect(ui.getByRole('button',{name:completeName})).toBeEnabled();
 await expect(ui.getByText('資料作成やLINE連絡を行わず、このまま完了できます。')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/survey-date-complete-${width}.png`,fullPage:true});
 await ui.getByRole('button',{name:completeName}).click();await expect(ui).toHaveCount(0);await expect(page).toHaveURL(list);
 await expect(page.getByRole('searchbox',{name:'アンケートの生徒を検索'})).toHaveValue('架空');
 await expect(page.getByRole('combobox',{name:'アンケートの担任'})).toHaveValue('工藤');
 await expect(page.getByRole('button',{name:openerName})).toBeFocused();
 await page.getByRole('button',{name:openerName}).click();await expect(ui.getByRole('button',{name:'保存済み',exact:true})).toBeDisabled();
 await ui.getByRole('button',{name:completeName}).click();await expect(ui).toHaveCount(0);
 expect(state.created).toBe(1);expect(state.writes).toEqual(['/api/staff/survey-workflow:date']);
});

test('canceling before save preserves the draft and makes no appointment',async({page})=>{
 const state=await fixture(page);const ui=await open(page);
 await ui.getByLabel('面談日',{exact:true}).fill('2099-10-04');
 await expect(ui.getByRole('button',{name:completeName})).toHaveCount(0);
 await ui.getByRole('button',{name:'アンケートの回答一覧に戻る'}).click();await expect(ui).toHaveCount(0);
 await page.getByRole('button',{name:openerName}).click();await expect(ui.getByLabel('面談日',{exact:true})).toHaveValue('2099-10-04');
 await ui.getByRole('button',{name:'アンケートの回答一覧に戻る'}).click();expect(state.writes).toEqual([]);expect(state.created).toBe(0);
});

test('a failed save keeps the draft and only a successful retry exposes completion',async({page})=>{
 const state=await fixture(page,{fail:true});const ui=await open(page);
 await ui.getByLabel('面談日',{exact:true}).fill('2099-10-04');await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(ui.getByRole('alert')).toContainText('保存に失敗');await expect(ui.getByRole('button',{name:completeName})).toHaveCount(0);
 await ui.getByRole('button',{name:'アンケートの回答一覧に戻る'}).click();await page.getByRole('button',{name:openerName}).click();
 await expect(ui.getByLabel('面談日',{exact:true})).toHaveValue('2099-10-04');await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(ui.getByRole('button',{name:completeName})).toBeVisible();await ui.getByRole('button',{name:completeName}).click();
 expect(state.attempts).toBe(2);expect(state.created).toBe(1);
});

test('a saved appointment remains completable when its display refresh fails',async({page})=>{
 const state=await fixture(page,{failRefresh:true});const ui=await open(page);
 await ui.getByLabel('面談日',{exact:true}).fill('2099-10-04');await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(ui.getByRole('alert')).toContainText('面談日は保存済み');await expect(ui.getByRole('button',{name:'保存済み',exact:true})).toBeDisabled();
 await ui.getByRole('button',{name:completeName}).click();await expect(ui).toHaveCount(0);expect(state.created).toBe(1);expect(state.attempts).toBe(1);
});

test('progress refresh retains the open completion panel until returning to the filtered list',async({page})=>{
 const state=await fixture(page);const ui=await open(page,'needs-review');
 await ui.getByLabel('面談日',{exact:true}).fill('2099-10-04');await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(page.getByLabel('架空 花子の対応状況')).toHaveValue('scheduled');await expect(ui.getByRole('button',{name:completeName})).toBeVisible();
 await ui.getByRole('button',{name:completeName}).click();await expect(ui).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'アンケートの進捗'})).toHaveValue('needs-review');
 await expect(page.getByText('条件に合う回答はありません。')).toBeVisible();await expect(page.getByRole('searchbox',{name:'アンケートの生徒を検索'})).toBeFocused();expect(state.created).toBe(1);
});

test('direct entry has a safe list return after an uncertain response without duplicate creation',async({page})=>{
 const state=await fixture(page,{lostResponse:true});await page.goto(`/staff/survey-workflow?answer=${answer}&return=https://example.invalid`);
 const ui=page.getByRole('region',{name:'面談入力'});await ui.getByLabel('面談日',{exact:true}).fill('2099-10-04');
 await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();await expect(ui.getByRole('alert')).toContainText('保存結果を確認できません');
 await ui.getByRole('button',{name:'最新情報を読み直す（入力保持）'}).click();await expect(ui.getByRole('button',{name:'保存済み',exact:true})).toBeDisabled();
 await ui.getByRole('button',{name:completeName}).click();await expect(page).toHaveURL(list);
 expect(state.created).toBe(1);expect(state.attempts).toBe(1);
});

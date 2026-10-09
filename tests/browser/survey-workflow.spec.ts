import {test,expect} from '@playwright/test';

for(const embedded of [false,true])test(`a trashed schedule is not marked saved and can be saved to the current availability (embedded: ${embedded})`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const id='11111111-1111-4111-8111-111111111111';let saved=false,saves=0;
 await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill({json:{student:{name:'架空 花子',number:'2019001',grade:'中2'},staffName:'工藤',scheduleTeacher:'工藤',
  survey:{id,url:'https://example.invalid',date:'2026-10-08',time:'18:40',editedAt:'v1'},bensuke:{state:saved?'synced':'deleted',id:saved?'current-slot':'',url:saved?'https://example.invalid/current-slot':'',endTime:'19:25',method:'３者Zoom',styled:true},accounts:[],record:null}}));
 await page.route('**/api/staff/survey-workflow',route=>{const body=route.request().postDataJSON();expect(body.action).toBe('date');expect(body.date).toBe('2026-10-08');expect(body.time).toBe('18:40');saves++;saved=true;return route.fulfill({json:{ok:true,bensuke:{id:'current-slot',state:'synced',url:'https://example.invalid/current-slot',endTime:'19:25',method:'３者Zoom',styled:true}}});});
 if(embedded){
  await page.route('**/api/interview-surveys',route=>route.fulfill({json:{groups:[{teacher:'工藤',students:[{grade:'中2',name:'架空 花子',notionUrl:`https://www.notion.so/${id.replaceAll('-','')}`,submittedAt:'2026-10-01T00:00:00Z'}]}]}}));
  await page.route('**/api/interview-surveys/confirmations',route=>route.fulfill({json:{states:[]}}));await page.route('**/api/interview-surveys/scheduling',route=>route.fulfill({json:{states:{}}}));
  await page.goto('/staff/surveys/2026-autumn');await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).fill('架空');await page.getByRole('button',{name:'架空 花子：日程連絡・面談記録・LINE'}).click();
 }else await page.goto(`/staff/survey-workflow?answer=${id}`);
 const ui=page.getByRole('region',{name:'面談入力'});
 await expect(ui.getByText(/以前のベンスケ予定はゴミ箱/)).toBeVisible();await expect(ui.getByText('保存済み：アンケートとベンスケに登録されています。')).toHaveCount(0);
 await expect(ui.getByRole('link',{name:'ベンスケの面談予定 ↗'})).toHaveCount(0);await expect(ui.getByRole('button',{name:'面談日を保存',exact:true})).toBeEnabled();
 await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(ui.getByRole('button',{name:'保存済み',exact:true})).toBeDisabled();await expect(ui.getByRole('link',{name:'ベンスケの面談予定 ↗'})).toHaveAttribute('href','https://example.invalid/current-slot');
 expect(saves).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:`analysis_outputs/trashed-survey-save-${embedded}.png`,fullPage:true});
});

test('survey date save registers Bensuke, keeps drafts on failure, and can register an already saved date',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const id='11111111-1111-4111-8111-111111111111';let state='new',attempts=0,time='',endTime='';
 await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill({json:{student:{name:'架空 生徒',number:'2019001',grade:'中2'},staffName:'工藤',scheduleTeacher:'金城',
  survey:{id,url:'https://example.invalid',date:'2026-10-03',time,editedAt:'v1'},bensuke:{state,endTime,method:'３者Zoom',styled:true,url:state==='synced'?'https://example.invalid/schedule':''},accounts:[],record:null}}));
 await page.route('**/api/staff/survey-workflow',route=>{
  const body=route.request().postDataJSON();expect(body.action).toBe('date');expect(body.date).toBe('2026-10-03');attempts++;
  if(attempts===1)return route.fulfill({status:503,json:{error:'保存結果を確認できません。再試行してください。'}});
  time=body.time;endTime=body.endTime;state='synced';return route.fulfill({json:{ok:true,bensuke:{state,endTime,method:'３者Zoom',styled:true,url:'https://example.invalid/schedule'}}});
 });
 await page.goto(`/staff/survey-workflow?answer=${id}`);
 await expect(page.getByRole('button',{name:'面談日を保存',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(page.getByRole('region',{name:'面談入力'}).getByRole('alert')).toContainText('再試行');await expect(page.getByLabel('面談日',{exact:true})).toHaveValue('2026-10-03');
 await page.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(page.getByText('面談日をアンケートとベンスケに保存しました。')).toBeVisible();
 await expect(page.getByRole('link',{name:'ベンスケの面談予定 ↗'})).toHaveAttribute('href','https://example.invalid/schedule');
 await page.getByLabel('開始時刻（任意）').fill('18:15');await page.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(page.getByRole('button',{name:'保存済み',exact:true})).toBeDisabled();
 expect(attempts).toBe(3);expect(time).toBe('18:15');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'analysis_outputs/survey-bensuke/mobile.png',fullPage:true});
});

for(const embedded of [true,false])for(const expiredInitially of [true,false])test(`inline relogin preserves interview drafts (initial expiry: ${expiredInitially}, embedded: ${embedded})`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 let authenticated=!expiredInitially,mutations=0,logins=0;
 const answer='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill(authenticated?{json:{student:{name:'架空 花子',number:'2019001',grade:'中2'},staffName:'工藤',survey:{id:answer,url:'https://example.invalid',date:'2026-10-03',time:'',editedAt:'v1'},accounts:[],record:{id:'record',body:'保存済み',blockId:'block',blockEditedAt:'v1',editable:true}}}:{status:401,json:{error:'ログインしなおしてください。'}}));
 await page.route('**/api/staff/survey-workflow',route=>{mutations++;return route.fulfill({status:401,json:{error:'ログインしなおしてください。'}});});
 await page.route('**/api/staff/session',route=>{
  expect(route.request().method()).toBe('POST');const body=route.request().postDataJSON();expect(body.staffCode).toBe('KUDO');
  logins++;if(body.password==='wrong')return route.fulfill({status:401,json:{error:'パスワードを確認してください。'}});
  authenticated=true;return route.fulfill({json:{staff:{staffCode:'KUDO'}}});
 });
 if(embedded){
  await page.route('**/api/interview-surveys',route=>route.fulfill({json:{groups:[{teacher:'工藤',students:[{grade:'中2',name:'架空 花子',notionUrl:`https://app.notion.com/p/${answer.replaceAll('-','')}`,submittedAt:'2026-10-01T00:00:00Z'}]}]}}));
  await page.route('**/api/interview-surveys/confirmations',route=>route.fulfill({json:{states:[]}}));
  await page.route('**/api/interview-surveys/scheduling',route=>route.fulfill({json:{states:{}}}));
  await page.goto('/staff/surveys/2026-autumn');await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).fill('架空');await page.getByRole('button',{name:'架空 花子：日程連絡・面談記録・LINE'}).click();
 }else await page.goto(`/staff/survey-workflow?answer=${answer}`);
 if(!expiredInitially){if(embedded)await page.getByRole('button',{name:'面談記録',exact:true}).click();await page.getByLabel('面談内容',{exact:true}).fill('未保存の面談メモ');authenticated=false;await page.getByRole('button',{name:'面談記録を更新'}).click();}
 const form=page.getByRole('form',{name:'面談の職員ログイン'});
 await expect(form).toBeVisible();await form.getByRole('button',{name:'工藤さんの入口',exact:true}).click();
 if(embedded&&expiredInitially)await page.screenshot({path:'analysis_outputs/survey-relogin-mobile.png',fullPage:true});
 await form.getByLabel('パスワード').fill('wrong');await form.getByRole('button',{name:'ログインして面談を再開'}).click();
 await expect(page.getByRole('region',{name:'面談入力'}).getByRole('alert')).toContainText('パスワードを確認');await expect(form.getByLabel('パスワード')).toHaveValue('');
 await form.getByLabel('パスワード').fill('isolated-test');await form.getByRole('button',{name:'ログインして面談を再開'}).click();
 await expect(form).toHaveCount(0);if(embedded&&expiredInitially)await page.getByRole('button',{name:'面談記録',exact:true}).click();await expect(page.getByLabel('面談内容',{exact:true})).toHaveValue(expiredInitially?'保存済み':'未保存の面談メモ');
 expect(mutations).toBe(expiredInitially?0:1);expect(logins).toBe(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

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
 await expect(page.getByText('面談日をアンケートとベンスケに保存しました。')).toBeVisible();
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

test('survey list opens inline, preserves drafts and saves time without sending LINE',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const answer='11111111111141118111111111111111';
 let date='',time='',endTime='',content='',sends=0;
 await page.route('**/api/interview-surveys',route=>route.fulfill({json:{groups:[{teacher:'工藤',students:[{grade:'中2',name:'架空 花子',notionUrl:`https://app.notion.com/p/${answer}`,submittedAt:'2026-10-01T00:00:00Z'}]}]}}));
 await page.route('**/api/interview-surveys/confirmations',route=>route.fulfill({json:{states:[]}}));
 await page.route('**/api/interview-surveys/scheduling',route=>route.fulfill({json:{states:{},updatedAt:'2026-10-01T00:00:00Z'}}));
 await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill({json:{
  student:{name:'架空 花子',number:'2019001',grade:'中2'},staffName:'工藤',survey:{id:answer,url:'https://example.invalid',date,time,editedAt:'version'},
  bensuke:{state:date?'synced':'new',endTime,method:'３者Zoom',styled:true},
  answerFields:[{label:'ご相談内容',value:'勉強の進め方について相談したい'}],accounts:[{id:'mother',relation:'mother',label:'母・確認済み'}],
  record:date?{id:'record',body:content,existingText:'これまでの面談記録',blockId:content?'block':'',blockEditedAt:'version',editable:true}:null,
  history:[{id:'reply',line_user_id:'mother',direction:'inbound',text:'18時でお願いします',received_at:'2026-10-01T00:00:00Z'}]
 }}));
 await page.route('**/api/staff/survey-workflow',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='date'){date=body.date;time=body.time;endTime=body.endTime;}
  if(body.action==='record')content=body.content;
  if(body.action==='send')sends++;
  await route.fulfill({json:{ok:true}});
 });
 await page.goto('/staff/surveys/2026-autumn');
 await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).fill('架空');
 const open=page.getByRole('button',{name:'架空 花子：日程連絡・面談記録・LINE'});
 await open.click();
 const workspace=page.getByRole('region',{name:'面談入力'});
 await expect(workspace.getByText('勉強の進め方について相談したい')).toBeVisible();
 await expect(page).toHaveURL(/\/staff\/surveys\/2026-autumn$/);
 await workspace.getByRole('button',{name:'面談記録',exact:true}).click();
 await workspace.getByLabel('面談内容',{exact:true}).fill('相談の記録を書きかけ');
 await workspace.getByRole('button',{name:'日程・LINE返信',exact:true}).click();
 await workspace.getByLabel('面談日',{exact:true}).fill('2026-10-02');
 await workspace.getByLabel('開始時刻（任意）').fill('18:00');
 await workspace.getByRole('button',{name:'面談日を保存',exact:true}).click();
 await expect(workspace.getByText('面談日をアンケートとベンスケに保存しました。')).toBeVisible();
 await workspace.getByText('最近のLINEのやり取り',{exact:true}).click();
 await expect(workspace.getByText('18時でお願いします',{exact:true})).toBeVisible();
 await workspace.getByRole('button',{name:'日程から文面を作る'}).click();
 await expect(workspace.getByLabel('日程連絡の文面')).toHaveValue(/18:00/);
 await workspace.getByRole('button',{name:'面談記録',exact:true}).click();
 await expect(workspace.getByLabel('面談内容',{exact:true})).toHaveValue('相談の記録を書きかけ');
 await expect(workspace.getByText('これまでの面談記録',{exact:true})).toBeVisible();
 await open.click();await open.click();
 await workspace.getByRole('button',{name:'面談記録',exact:true}).click();
 await expect(workspace.getByLabel('面談内容',{exact:true})).toHaveValue('相談の記録を書きかけ');
 await workspace.getByRole('button',{name:'面談記録を更新',exact:true}).click();
 await expect(workspace.getByText('面談内容をNotionの面談記録に保存しました。')).toBeVisible();
 expect(sends).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'analysis_outputs/survey-inline-mobile.png',fullPage:true});
});

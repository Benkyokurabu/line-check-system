import {test,expect} from '@playwright/test';
const answer='11111111-1111-4111-8111-111111111111';
for(const embedded of [false,true])test(`date saving remains visible through refresh, then becomes saved (embedded: ${embedded})`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 let saved=false,reads=0,releaseSave!:()=>void,releaseRefresh!:()=>void,saveStarted!:()=>void,refreshStarted!:()=>void;
 const saving=new Promise<void>(r=>{releaseSave=r;}),refreshing=new Promise<void>(r=>{releaseRefresh=r;}),started=new Promise<void>(r=>{saveStarted=r;}),refreshSeen=new Promise<void>(r=>{refreshStarted=r;});
 await page.route('**/api/staff/survey-workflow?answer=*',async route=>{reads++;if(reads>1){refreshStarted();await refreshing;}return route.fulfill({json:{student:{name:'架空 花子',number:'2019001',grade:'中2'},staffName:'工藤',scheduleTeacher:'工藤',
  survey:{id:answer,url:'https://example.invalid',date:saved?'2026-10-03':'',time:saved?'18:00':'',editedAt:'v1'},bensuke:{state:saved?'synced':'new',method:'３者Zoom',endTime:saved?'18:45':'',styled:true},accounts:[],record:null}});});
 await page.route('**/api/staff/survey-workflow',async route=>{const body=route.request().postDataJSON();expect(body.action).toBe('date');expect(body.endTime).toBe('18:45');expect(body.method).toBe('３者Zoom');saveStarted();await saving;saved=true;return route.fulfill({json:{ok:true,bensuke:{state:'synced',method:'３者Zoom',endTime:'18:45',styled:true}}});});
 if(embedded){await page.route('**/api/interview-surveys',route=>route.fulfill({json:{groups:[{teacher:'工藤',students:[{grade:'中2',name:'架空 花子',notionUrl:`https://www.notion.so/${answer.replaceAll('-','')}`,submittedAt:'2026-10-01T00:00:00Z'}]}]}}));await page.route('**/api/interview-surveys/confirmations',route=>route.fulfill({json:{states:[]}}));await page.route('**/api/interview-surveys/scheduling',route=>route.fulfill({json:{states:{}}}));await page.goto('/staff/surveys/2026-autumn');await page.getByRole('searchbox',{name:'アンケートの生徒を検索'}).fill('架空');await page.getByRole('button',{name:'架空 花子：日程連絡・面談記録・LINE'}).click();}
 else await page.goto(`/staff/survey-workflow?answer=${answer}`);
 const ui=page.getByRole('region',{name:'面談入力'});await ui.getByLabel('面談日',{exact:true}).fill('2026-10-03');await ui.getByLabel('開始時刻（任意）').fill('18:00');await ui.getByRole('button',{name:'面談日を保存',exact:true}).click();await started;
 await expect(ui.getByRole('button',{name:'保存中…',exact:true})).toBeDisabled();await expect(ui.getByText('保存中：アンケートとベンスケに面談日を保存しています。')).toBeVisible();await expect(ui.getByLabel('開始時刻（任意）')).toBeDisabled();
 releaseSave();await refreshSeen;await expect(ui.getByRole('button',{name:'保存中…',exact:true})).toBeDisabled();await expect(ui.getByText('面談日をアンケートとベンスケに保存しました。')).toHaveCount(0);
 releaseRefresh();await expect(ui.getByRole('button',{name:'保存済み',exact:true})).toBeDisabled();await expect(ui.getByText('保存済み：アンケートとベンスケに登録されています。')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:`analysis_outputs/survey-save-line-style/saved-${embedded}.png`,fullPage:true});
 await ui.getByLabel('開始時刻（任意）').fill('19:00');await expect(ui.getByRole('button',{name:'面談日を保存',exact:true})).toBeEnabled();
});
test('guardian LINE cards show the student-number link and preview only the selected mother',async({page})=>{
 await page.setViewportSize({width:390,height:844});let sends=0;
 const accounts=[{id:'mother',relation:'mother',category:'guardian',studentNumber:'2019001',label:'母・本 山田花 母',aliasName:'本 山田花 母',displayName:'花の母',verification:'registered'},
 {id:'student',relation:'student',category:'student',studentNumber:'2019001',label:'本人・本 山田花',verification:'registered'}];
 await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill({json:{student:{name:'山田 花',number:'2019001',grade:'中2'},staffName:'工藤',survey:{id:answer,url:'https://example.invalid',date:'2026-10-03',time:'18:00',editedAt:'v1'},bensuke:{state:'synced',method:'３者Zoom',endTime:'18:45',styled:true},accounts,record:null}}));
 await page.route('**/api/staff/survey-workflow',route=>{const body=route.request().postDataJSON();expect(body.action).toBe('send');expect(body.messages).toEqual([{lineUserId:'mother',text:'10月3日18時から面談をお願いします。'}]);sends++;return route.fulfill({json:{results:[{lineUserId:'mother',status:'sent'}]}});});
 await page.goto(`/staff/survey-workflow?answer=${answer}`);
 const schedule=page.getByRole('heading',{name:'2　日程をLINEで連絡する'}).locator('..');
 await expect(schedule.getByText('山田 花さんのLINE宛先')).toBeVisible();await expect(schedule.getByText('LINE表示名：花の母')).toBeVisible();await expect(schedule.getByText(/に登録された宛先です。保護者 1件/)).toBeVisible();
 const parents=schedule.getByRole('group',{name:'保護者のLINE（送信先をチェック）'});await expect(parents.getByRole('checkbox')).toHaveCount(1);await expect(schedule.getByRole('group',{name:'本人のLINE（必要な場合に選択）'})).toBeVisible();
 await parents.getByRole('checkbox',{name:'母・本 山田花 母'}).check();await schedule.getByLabel('日程連絡の文面').fill('10月3日18時から面談をお願いします。');await schedule.getByRole('button',{name:'宛先・文面を確認'}).click();
 await expect(schedule.getByText('山田 花さんの保護者宛て')).toBeVisible();await expect(schedule.getByText(/以下の 1件だけに送信/)).toBeVisible();expect(sends).toBe(0);
 await page.screenshot({path:'analysis_outputs/survey-save-line-style/guardian-preview.png',fullPage:true});await schedule.getByRole('button',{name:'表示した宛先へLINE送信'}).click();await expect.poll(()=>sends).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
test('a saved date remains saved when the subsequent display refresh fails',async({page})=>{
 let saved=false;await page.route('**/api/staff/survey-workflow?answer=*',route=>route.fulfill(saved?{status:503,json:{error:'表示取得失敗'}}:{json:{student:{name:'架空 生徒',number:'2019001',grade:'中2'},staffName:'工藤',survey:{id:answer,url:'https://example.invalid',date:'2026-10-03',time:'',editedAt:'v1'},bensuke:{state:'new',method:'３者Zoom',endTime:''},accounts:[],record:null}}));
 await page.route('**/api/staff/survey-workflow',route=>{saved=true;return route.fulfill({json:{ok:true,bensuke:{state:'synced',method:'３者Zoom',endTime:'',styled:true}}});});
 await page.goto(`/staff/survey-workflow?answer=${answer}`);await page.getByRole('button',{name:'面談日を保存',exact:true}).click();await expect(page.getByRole('button',{name:'保存済み',exact:true})).toBeVisible();await expect(page.getByText(/面談日は保存済みです。最新表示/)).toBeVisible();
});

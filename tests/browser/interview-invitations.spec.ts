import {test,expect} from '@playwright/test';
test('ログイン済みで秋アンケートから回答・候補日時・打診確認へ進む',async({page})=>{
 const ops:Record<string,unknown>[]=[];const id='00000000-0000-4000-8000-000000000001',slot={id:'00000000-0000-4000-8000-000000000002',version:1,studentId:id,date:'2030-01-03',start:'13:00',end:'13:45',teacher:'工藤'};
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{staffId:'staff',staffCode:'KUDO',displayName:'工藤',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests',r=>r.fulfill({json:{requests:[],bookings:[],slots:[],snapshot:'s',loginReady:false}}));
 await page.route('**/api/staff/interview-invitations*',r=>{
  if(r.request().method()==='POST'){ops.push(r.request().postDataJSON());return r.fulfill({json:{saved:{},notification:{status:'sent',message:'工藤の検証用LINEへ案内を送信しました。'}}});}
  if(r.request().url().includes('slots=1'))return r.fulfill({json:{slots:[slot]}});
  return r.fulfill({json:{pilotReady:true,rounds:[{id:'2026-autumn',label:'2026年 秋のアンケート'}],syncedAt:null,invitations:[],notifications:[],students:[{id,number:'2018999',name:'工藤検証',teacher:'工藤',grade:'中3',pilot:true,surveys:[{round:'2026-autumn',status:'submitted',date:'2026-09-20',responses:[{id:'answer',date:'2026-09-20',url:'https://www.notion.so/example',fields:[{label:'相談',value:'進路について相談'}]}]}]},{id:'other',number:'OTHER',name:'架空生徒',teacher:'先生A',grade:'中1',pilot:false,surveys:[{round:'2026-autumn',status:'submitted',date:'2026-09-20'}]}]}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto('/staff/interviews?tab=invitations&survey=2026-autumn');
 await expect(page.getByRole('combobox',{name:'対象アンケート',exact:true})).toHaveValue('2026-autumn');await expect(page.getByRole('combobox',{name:'担任',exact:true})).toHaveValue('工藤');await expect(page.getByLabel('パスワード',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'回答を見る',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('進路について相談');await page.getByRole('dialog').getByRole('button',{name:'← 戻る',exact:true}).click();
 await page.getByRole('combobox',{name:'担任',exact:true}).selectOption('');await page.getByRole('article',{name:'架空生徒',exact:true}).getByRole('button',{name:'日程を打診する'}).click();await expect(page.getByText('現在は工藤の確認用生徒だけに送信できます。一般家庭への打診はまだ開始していません。')).toBeVisible();await expect(page.getByRole('button',{name:'打診内容を確認'})).toHaveCount(0);await page.getByRole('button',{name:'アンケートの生徒一覧へ'}).click();
 await page.getByRole('article',{name:'工藤検証',exact:true}).getByRole('button',{name:'日程を打診する'}).click();await page.getByRole('checkbox',{name:'2030-01-03 の枠を選択'}).check();await page.getByLabel('回答期限（日本時間）').fill('2030-01-02T12:00');await page.getByRole('button',{name:'打診内容を確認'}).click();expect(ops).toHaveLength(0);
 const dialog=page.getByRole('dialog',{name:'面談日程の打診確認'});await expect(dialog).toContainText('工藤検証');await dialog.getByRole('button',{name:'LINEで日程を打診する（工藤のみ）'}).click();await expect(page.getByRole('status')).toContainText('案内を送信しました');expect(ops[0].studentId).toBe(id);expect(ops[0].campaignId).toBe('2026-autumn');expect(ops[0].slots).toEqual([{id:slot.id,version:1}]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/interview-invitations/staff-mobile.png',fullPage:true});
});
test('保護者の回答に案内IDと版を付け、案内のない場合は希望送信を無効にする',async({page})=>{
 const id='student',slot={id:'slot',studentId:id,date:'2030-01-03',start:'13:00',end:'13:45'};let operation:Record<string,unknown>|undefined;
 await page.route('**/api/staff/interview-live-preview',r=>{if(r.request().method()==='POST'){operation=r.request().postDataJSON();return r.fulfill({json:{saved:true,request:{id:'request',studentId:id,status:'pending',version:1,note:'',reason:'',choices:[{...slot,slotId:slot.id}],confirmed:null}}});}return r.fulfill({json:{invitationOnly:true,invitations:[{id:'invitation',studentId:id,version:1,expiresAt:'2030-01-02T03:00:00Z'}],students:[{id,name:'工藤検証',teacher:'工藤'}],slots:[slot],requests:[]}})});
 await page.goto('/interviews/trial');await page.getByRole('button',{name:/1月3日/}).click();await page.getByRole('button',{name:'選んだ日程を確認する'}).click();await page.getByRole('button',{name:'予約希望を送信する',exact:true}).click();await expect(page.getByText('承認待ち',{exact:true})).toBeVisible();expect(operation?.invitationId).toBe('invitation');expect(operation?.invitationVersion).toBe(1);
 await page.route('**/api/staff/interview-live-preview',r=>r.fulfill({json:{invitationOnly:true,invitations:[],students:[{id,name:'工藤検証',teacher:'工藤'}],slots:[],requests:[]}}));await page.reload();await expect(page.getByText(/回答受付中の案内はありません/)).toBeVisible();await expect(page.getByRole('button',{name:'選んだ日程を確認する'})).toBeDisabled();
});

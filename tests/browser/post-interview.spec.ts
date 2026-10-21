import {test,expect} from '@playwright/test';
import {blankPostFields} from '../../src/lib/post-interview-core.mjs';
const answer='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222',record='33333333-3333-4333-8333-333333333333';
const staff={staffId:'44444444-4444-4444-8444-444444444444',staffCode:'KUDO',role:'admin',displayName:'工藤'};
function model(){return {entry:null as null|Record<string,unknown>,payload:{answerId:answer,studentPageId:student,recordPageId:'',sourceText:'',participants:'',fields:blankPostFields()},student:{id:student,name:'見本の生徒',number:'2026999',grade:'中３'},survey:{id:answer,preparation:'完了',handling:'未着手',date:'2026-10-17'},records:[{id:record,title:'既存の面談',date:'2026-10-17',url:'https://example.invalid'}],staffOptions:[{id:staff.staffId,name:'工藤'}],options:{method:['３者Zoom'],grade:['中３'],purpose:['進路']},accounts:[{id:'mother',label:'母・確認済み',verification:'confirmed',category:'guardian'},{id:'student',label:'本人・確認済み',verification:'confirmed',category:'student'},{id:'unverified',label:'未確認の連絡先',verification:'registered',category:'unknown'}],entries:[],originalBody:'元の段落は保持されます',originalUrl:'https://example.invalid/original',snapshot:'v1'};}

for(const width of [1280,390])test(`送り先と本文だけで送信し、未保存の記録と二重送信防止を保つ ${width}px`,async({page})=>{
 const data=model(),calls:Array<Record<string,unknown>>=[];let fail=true;
 await page.setViewportSize({width,height:1000});await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/post-interview*',async r=>{
  if(r.request().method()==='GET')return r.fulfill({json:data});
  const body=r.request().postDataJSON();calls.push(body);
  expect(body.action).toBe('send-line');expect(body.deliveryApproval).toEqual([{id:'unverified',text:'ご面談ありがとうございました。来週ご相談します。',external:false,externalNote:'',confirmResend:false}]);
  if(fail){fail=false;return r.fulfill({status:503,json:{error:'通信失敗。本文は保持しています。'}});}
  await new Promise(resolve=>setTimeout(resolve,250));
  const entry={id:body.id,version:1,payload:data.payload,status:'review',targets:{record:{status:'skipped'},survey:{status:'skipped'},lines:{unverified:{id:'unverified',label:'未確認の連絡先',text:body.deliveryApproval[0].text,status:'accepted'}}}};
  return r.fulfill({json:{entry}});
 });
 await page.goto('/staff/survey-workflow/post-interview?answer='+answer);const section=page.getByRole('region',{name:'LINEを送る',exact:true});
 await expect(page.getByLabel('反映する面談記録',{exact:true})).toHaveValue('');await expect(section.getByRole('button',{name:'送信する',exact:true})).toBeDisabled();
 await page.getByRole('textbox',{name:'面談の原文・補足',exact:true}).fill('職員用の未保存の記録。LINE本文と区別する。');
 await section.getByRole('checkbox',{name:'未確認の連絡先',exact:true}).check();
 await section.getByRole('textbox',{name:'本文',exact:true}).fill('a'.repeat(5001));await expect(section.getByRole('button',{name:'送信する',exact:true})).toBeDisabled();
 await section.getByRole('textbox',{name:'本文',exact:true}).fill('ご面談ありがとうございました。来週ご相談します。');
 await expect(section.getByRole('button',{name:'送信する',exact:true})).toBeEnabled();await expect(section.getByRole('checkbox')).toHaveCount(3);
 await section.screenshot({path:`analysis_outputs/post-interview/simple-line-${width}.png`});
 await section.getByRole('button',{name:'送信する',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('通信失敗');
 await expect(section.getByRole('textbox',{name:'本文',exact:true})).toHaveValue('ご面談ありがとうございました。来週ご相談します。');await expect(section.getByRole('checkbox',{name:'未確認の連絡先',exact:true})).toBeChecked();
 await section.getByRole('button',{name:'送信する',exact:true}).click();await expect(section.getByRole('button',{name:'処理中…',exact:true})).toBeDisabled();await expect(section.getByRole('button',{name:'送信済み',exact:true})).toBeDisabled();
 expect(calls).toHaveLength(2);expect(calls[0].operationKey).toBe(calls[1].operationKey);
 await expect(page.getByRole('textbox',{name:'面談の原文・補足',exact:true})).toHaveValue('職員用の未保存の記録。LINE本文と区別する。');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const width of [1280,390])test(`面談後の入力・明示選択・候補確認・宛先別送信 ${width}px`,async({page})=>{
 const data=model();data.options.purpose=['進路','学習相談'];const calls:Array<Record<string,unknown>>=[];
 await page.setViewportSize({width,height:1000});await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/post-interview*',r=>{
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();calls.push(body);
   if(body.action==='draft-ai')return r.fulfill({json:{fields:{title:{value:'AIの候補',state:'review',source:'相談した',reason:'確認待ち',candidates:[]},record:{value:'記録の候補',state:'review',source:'相談した',reason:'確認待ち',candidates:[]}}}});
   const entry={id:body.id,version:body.version+1,payload:body.payload??data.payload,status:'review',targets:{record:{status:'synced',pageId:record},survey:{status:'review',error:'対応を確認後、確定にしてください'},lines:body.action==='send-line'?{mother:{id:'mother',label:'母',text:body.deliveryApproval[0].text,status:'accepted'},student:{id:'student',label:'本人',text:body.deliveryApproval[0].text,status:'failed',error:'通信失敗'}}:{}}};
   data.entry=entry;data.payload=entry.payload;return r.fulfill({json:{entry}});
  }return r.fulfill({json:data});
 });
 await page.goto('/staff/survey-workflow/post-interview?answer='+answer);await expect(page.getByRole('heading',{name:'見本の生徒さんの面談'})).toBeVisible();
 await expect(page.getByRole('button',{name:'保存して記録・対応へ反映',exact:true})).toBeDisabled();await page.getByLabel('反映する面談記録',{exact:true}).selectOption('new');
 const purpose=page.getByRole('group',{name:'面談目的',exact:true});await expect(purpose.getByRole('checkbox')).toHaveCount(2);await purpose.getByRole('checkbox',{name:'進路',exact:true}).check();await purpose.getByRole('checkbox',{name:'学習相談',exact:true}).check();await expect(page.locator('#post-state-purpose')).toHaveValue('confirmed');
 await page.getByLabel('面談の見出し',{exact:true}).fill('自分で入力した見出し');await page.getByLabel('面談の原文・補足',{exact:true}).fill('相談した');await page.getByRole('button',{name:'AIで記録と共有文の候補を作る'}).click();
 await expect(page.getByLabel('面談の見出し',{exact:true})).toHaveValue('自分で入力した見出し');await expect(page.locator('#post-state-record')).toHaveValue('review');
 await page.getByLabel('実施日',{exact:true}).fill('2026-10-17');await page.getByLabel('Notion用の面談記録',{exact:true}).fill('確認した職員向けの記録');await page.getByLabel('本人・保護者へ共有する内容',{exact:true}).fill('確認した共有内容');
 await page.getByRole('button',{name:'保存して記録・対応へ反映',exact:true}).click();await expect(page.getByRole('heading',{name:'保存結果：確認後、確定にしてください'})).toBeVisible();await expect(page.getByText('対応を確認後、確定にしてください',{exact:true})).toBeVisible();
 await expect(page.getByRole('checkbox',{name:/未確認の連絡先/})).toBeEnabled();await page.getByRole('checkbox',{name:'母・確認済み',exact:true}).check();await page.getByRole('checkbox',{name:'本人・確認済み',exact:true}).check();
 expect(calls.filter(c=>c.action==='send-line')).toHaveLength(0);await expect(page.getByRole('button',{name:'送信する',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'送信する',exact:true}).click();await expect(page.getByText(/母：LINE受付済み/)).toBeVisible();await expect(page.getByText(/本人：失敗 通信失敗/)).toBeVisible();
 expect(calls.filter(c=>c.action==='send-line')).toHaveLength(1);const reflected=calls.find(c=>c.intent==='reflect') as {payload:ReturnType<typeof model>['payload']};expect(reflected.payload.fields.handling.state).toBe('unknown');expect(reflected.payload.fields.purpose.value).toBe('進路、学習相談');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`analysis_outputs/post-interview/workspace-${width}.png`,fullPage:true});
});
for(const width of [1280,390])test(`保存済み原文を二重入力せず記録本文に採用できる ${width}px`,async({page})=>{
 const data=model();data.payload.sourceText='保存済みの面談原文';data.payload.fields.title={...data.payload.fields.title,value:'面談の見出し',state:'confirmed'};data.payload.fields.date={...data.payload.fields.date,value:'2026-10-19',state:'confirmed'};
 await page.setViewportSize({width,height:1000});await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));await page.route('**/api/staff/post-interview*',r=>r.fulfill({json:data}));
 await page.goto('/staff/survey-workflow/post-interview?answer='+answer);await page.getByLabel('反映する面談記録',{exact:true}).selectOption('new');
 await expect(page.getByRole('status').filter({hasText:'新しい面談記録を作るには'})).toContainText('Notion用の面談記録：未入力です');
 await page.getByRole('button',{name:'原文をそのまま面談記録に使う',exact:true}).click();await expect(page.getByLabel('Notion用の面談記録',{exact:true})).toHaveValue(data.payload.sourceText);await expect(page.locator('#post-state-record')).toHaveValue('confirmed');await expect(page.getByRole('status').filter({hasText:'新しい面談記録を作るには'})).toHaveCount(0);
 await expect(page.getByText('アンケートの「対応済」を確定して反映すると、「面談準備」も「完了」にします。',{exact:false})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [1280,390])for(const hasMessages of [true,false])test(`宛先をその場で確認登録し、入力と送信の判断を保持する 履歴${hasMessages} ${width}px`,async({page})=>{
 const data=model(),lineId='U'+'a'.repeat(32);let registered=false,verifications=0,sends=0;
 const pending={id:lineId,label:'続柄未確認・登録済みの母',verification:'registered',category:'unknown',relation:'unknown',aliasName:'登録済みの母',displayName:'見本の母'};
 data.accounts=[pending];
 await page.setViewportSize({width,height:1000});await page.route('**/api/staff/session',r=>r.fulfill({json:{staff}}));
 await page.route('**/api/staff/post-interview*',r=>{if(r.request().method()==='POST')sends++;return r.fulfill({json:{...data,accounts:registered?[{...pending,label:'母・登録済みの母',verification:'confirmed',category:'guardian',relation:'mother'}]:[pending]}});});
 await page.route('**/api/admin/contacts/students',r=>r.fulfill({json:{students:[{student_number:'2026999',student_name:'見本の生徒',grade:'中３',campus:'本校',enrollment_status:'current_roster'}]}}));
 await page.route(`**/api/admin/contacts/${lineId}/messages?*`,r=>r.fulfill({json:{messages:hasMessages?[{id:'55555555-5555-4555-8555-555555555555',text:'見本の生徒の母です。',direction:'inbound',message_type:'text'}]:[]}}));
 await page.route(`**/api/admin/contacts/${lineId}/verify`,r=>{verifications++;const body=r.request().postDataJSON();expect(body.targets[0].student_number).toBe('2026999');expect(body.targets[0].relation).toBe('mother');expect(body.verified_by).toBe('工藤');if(!hasMessages){expect(body.evidence_message_id).toBeNull();expect(body.existing_contact_review).toEqual({confirmed:true,method:'existing_contact',note:''});}registered=true;return r.fulfill({json:{ok:true}});});
 page.on('dialog',d=>d.accept());await page.goto('/staff/survey-workflow/post-interview?answer='+answer);await page.getByLabel('反映する面談記録',{exact:true}).selectOption('new');await page.getByLabel('面談の原文・補足',{exact:true}).fill('編集中の原文を保持する');
 await expect(page.getByRole('group',{name:'送り先',exact:true}).getByRole('checkbox')).toBeEnabled();await page.getByText('送り先の管理・送信済みの記録',{exact:true}).click();await page.getByRole('button',{name:'本人・続柄を確認する',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'LINEの本人・続柄を確認'});if(hasMessages)await dialog.getByRole('button',{name:'見本の生徒の母です。',exact:true}).click();else{await expect(dialog.getByRole('combobox',{name:'本人確認の方法',exact:true})).toHaveValue('existing');await dialog.getByRole('combobox',{name:'確認方法',exact:true}).selectOption('existing_contact');}await dialog.getByRole('button',{name:'保護者',exact:true}).click();await dialog.getByRole('combobox',{name:/保護者の続柄/}).selectOption('mother');const save=dialog.getByRole('button',{name:'この内容で登録して一覧の名前を更新',exact:true});if(!hasMessages){await expect(save).toBeDisabled();await expect(dialog.getByRole('status').filter({hasText:'本人確認のチェック'})).toBeVisible();await dialog.getByRole('checkbox',{name:/このLINEの相手が/}).check();}await expect(save).toBeEnabled();await save.click();
 await expect(dialog).toHaveCount(0);await expect(page.getByRole('group',{name:'送り先',exact:true}).getByRole('checkbox')).toBeEnabled();await expect(page.getByRole('textbox',{name:'面談の原文・補足',exact:true})).toHaveValue('編集中の原文を保持する');expect(verifications).toBe(1);expect(sends).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('通信失敗・再ログイン後に原稿と操作番号を保持する',async({page})=>{
 const data=model(),keys:string[]=[];let expire=false,reads=0;
 await page.route('**/api/staff/session',r=>{expire=false;return r.fulfill({json:{staff}});});
 await page.route('**/api/staff/post-interview*',r=>{if(r.request().method()==='GET'){reads++;return r.fulfill({json:data});}keys.push(r.request().postDataJSON().operationKey);return r.fulfill({status:expire?401:503,json:{error:expire?'ログインし直してください':'通信失敗'}});});
 await page.goto('/staff/survey-workflow/post-interview?answer='+answer);await page.getByLabel('反映する面談記録',{exact:true}).selectOption('new');await page.getByLabel('Notion用の面談記録',{exact:true}).fill('未保存の大切な記録');
 await page.getByRole('button',{name:'下書きを保存',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('通信失敗');await page.getByRole('button',{name:'下書きを保存',exact:true}).click();await expect.poll(()=>keys.length).toBe(2);expect(keys[0]).toBe(keys[1]);
 expire=true;await page.getByRole('button',{name:'下書きを保存',exact:true}).click();await expect(page.getByRole('heading',{name:'職員ログイン'})).toBeVisible();await expect(page.getByLabel('Notion用の面談記録',{exact:true})).toHaveCount(0);
 const before=reads;await page.getByLabel('職員コード',{exact:true}).fill('KUDO');await page.getByLabel('パスワード',{exact:true}).fill('test-only');await page.getByRole('button',{name:'ログイン',exact:true}).click();await expect(page.getByLabel('Notion用の面談記録',{exact:true})).toHaveValue('未保存の大切な記録');expect(reads).toBe(before);
});
test('金城先生へ試用データの読み取りを開始しない',async({page})=>{let reads=0;await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{...staff,staffCode:'KINJO'}}}));await page.route('**/api/staff/post-interview*',r=>{reads++;return r.fulfill({status:403,json:{error:'denied'}});});await page.goto('/staff/survey-workflow/post-interview?answer='+answer);await expect(page.getByText('この機能は工藤先生の確認中です。既存の面談入力は引き続き利用できます。')).toBeVisible();expect(reads).toBe(0);});
test('匿名利用・別サイトの保存・未認証のワーカーを拒否する',async({request})=>{expect((await request.get('/api/staff/post-interview')).status()).toBe(401);expect((await request.post('/api/staff/post-interview',{headers:{Origin:'https://other.invalid'},data:{action:'save'}})).status()).toBe(403);expect((await request.get('/api/cron/post-interview-sync')).status()).toBe(401);});

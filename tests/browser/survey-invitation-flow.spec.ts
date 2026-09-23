import {test,expect,type Page} from '@playwright/test';
const student={id:'00000000-0000-4000-8000-000000000001',number:'2018999',name:'工藤検証',teacher:'工藤',grade:'中3',pilot:true,surveys:[{round:'2026-autumn',status:'submitted',date:'2026-09-20',responses:[]}]};
const slot={id:'00000000-0000-4000-8000-000000000002',version:1,studentId:student.id,date:'2030-01-03',start:'13:00',end:'13:45',teacher:'工藤'};
const state={pilotReady:true,rounds:[{id:'2026-autumn',label:'2026年 秋のアンケート'}],syncedAt:null,students:[student],invitations:[],notifications:[]};
async function auth(page:Page,code='KUDO'){
 await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{staffId:'staff',staffCode:code,displayName:code==='KUDO'?'工藤':'金城',role:'admin'}}}));
 await page.route('**/api/staff/interview-requests*',r=>r.fulfill({json:{requests:[],bookings:[],slots:[],snapshot:'s',loginReady:false}}));
}
async function confirm(page:Page){
 await page.goto('/staff/interviews?tab=invitations');await page.getByRole('button',{name:'日程を打診する',exact:true}).click();await page.getByRole('checkbox',{name:'2030-01-03 の枠を選択'}).check();await page.getByLabel('回答期限（日本時間）').fill('2030-01-02T12:00');await page.getByRole('button',{name:'打診内容を確認'}).click();
}
test('有効な打診は二重作成に進めず、提出済みと回答待ちを分ける',async({page})=>{
 await auth(page);await page.route('**/api/staff/interview-invitations*',r=>r.fulfill({json:{...state,invitations:[{id:'inv',student_id:student.id,status:'active',version:1,created_at:'2026-09-23',expires_at:'2030-01-02',notification_status:'sent',answerStatus:'unanswered'}]}}));
 await page.goto('/staff/interviews?tab=invitations');await expect(page.getByText('アンケート：提出済み')).toBeVisible();await expect(page.getByText('面談：回答待ち')).toBeVisible();await expect(page.getByRole('button',{name:'日程を打診する',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'打診・予約の詳細'}).click();await expect(page.getByText(/有効な打診があります/)).toBeVisible();
});
test('送信応答不明の再確認は同じ操作番号・送信後の一覧失敗でも結果保持',async({page})=>{
 await auth(page);const ops:Record<string,unknown>[]=[];let saved=false;
 await page.route('**/api/staff/interview-invitations*',r=>{
  if(r.request().method()==='POST'){ops.push(r.request().postDataJSON());if(ops.length===1)return r.fulfill({status:503,json:{error:'送信応答を確認できません。'}});saved=true;return r.fulfill({json:{saved:{},notification:{status:'sent',message:'工藤の検証用LINEへ案内を送信しました。'}}});}
  if(r.request().url().includes('slots=1'))return r.fulfill({json:{slots:[slot]}});
  return saved?r.fulfill({status:503,json:{error:'一覧取得エラー'}}):r.fulfill({json:state});
 });
 await page.setViewportSize({width:390,height:844});await confirm(page);const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'LINEで日程を打診する（工藤のみ）'}).click();await expect(dialog.getByRole('status')).toContainText('送信応答');await expect(page.getByRole('button',{name:'アンケートから選ぶ',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'保存・送信結果を再確認'}).click();
 await expect(page.getByRole('status')).toContainText('案内を送信しました');await expect(page.getByRole('region',{name:'アンケートから面談の日程を打診'}).getByRole('alert')).toContainText('送信結果は保持');expect(ops).toHaveLength(2);expect(ops[0]).toEqual(ops[1]);
});
test('アンケート取得失敗を未提出に見せず再取得できる',async({page})=>{
 await auth(page);let failed=true;await page.route('**/api/staff/interview-invitations*',r=>failed?r.fulfill({status:503,json:{error:'Notionのアンケートを取得できません。'}}):r.fulfill({json:state}));await page.goto('/staff/interviews?tab=invitations');await expect(page.getByRole('region',{name:'アンケートから面談の日程を打診'}).getByRole('alert')).toContainText('取得できません');await expect(page.getByText('アンケート：未提出',{exact:false})).toHaveCount(0);failed=false;await page.getByRole('button',{name:'一覧を更新',exact:true}).click();await expect(page.getByRole('article',{name:'工藤検証'})).toBeVisible();
});
test('金城の直接URLでも工藤限定の送信画面・APIを開かない',async({page})=>{
 await auth(page,'KINJO');let called=false;await page.route('**/api/staff/interview-invitations*',r=>{called=true;return r.fulfill({json:state});});await page.goto('/staff/interviews?tab=invitations');await expect(page.getByText('現在の日程案内は工藤専用の検証中です。一般保護者への送信はまだ開始していません。')).toBeVisible();expect(called).toBe(false);
});
test('トップの秋アンケートからログイン状態を保ったまま対象回を開く',async({page})=>{
 await auth(page);await page.route('**/api/interview-surveys',r=>r.fulfill({json:{groups:[]}}));await page.route('**/api/interview-surveys/confirmations',r=>r.fulfill({json:{states:[]}}));await page.route('**/api/staff/interview-invitations*',r=>r.fulfill({json:state}));await page.setViewportSize({width:390,height:844});await page.goto('/');const entry=page.getByRole('link',{name:'アンケートから選ぶ'});await expect(entry).toHaveAttribute('href','/staff/interviews?tab=invitations&survey=2026-autumn');await entry.click();await expect(page.getByRole('heading',{name:'アンケートから生徒を選ぶ'})).toBeVisible();await expect(page.getByLabel('パスワード',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'analysis_outputs/interview-invitations/survey-entry-mobile.png',fullPage:true});
});

import {test,expect,type Page} from '@playwright/test';
import {defaults} from '../../src/lib/interview-core.mjs';
import {readInterviewTrial,trialDay} from '../../src/lib/interview-trial.mjs';
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const student={id:'00000000-0000-4000-8000-000000000001',student_name:'架空生徒',student_number:'test01',grade:'中1',campus:'本校',homeroom_teacher:'架空講師'};
const appointment={studentId:student.id,studentName:student.student_name,teacher:'架空講師',date:today,start:'13:00',end:'13:45',campus:'本校',method:'対面',purpose:'学習相談',participants:'保護者',channel:'職員入力',note:'',room:''};
const booking={id:'booking',data:appointment,status:'confirmed',version:1,notion_page_id:'notion-test',notion_synced_version:1,sync_error:null};
async function session(page:Page){await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{staffId:'test',staffCode:'KUDO',displayName:'検証職員',role:'admin'}}}));}
async function interviews(page:Page,onWrite?:(body:Record<string,unknown>)=>boolean){
 await session(page);
 await page.route('**/api/staff/interviews',route=>{
  if(route.request().method()==='POST')return onWrite?.(route.request().postDataJSON())?route.abort():route.fulfill({json:{saved:{}}});
  return route.fulfill({json:{snapshot:'test',students:[student],teachers:['架空講師'],lessons:[],bookings:[booking],slots:[],settings:{data:defaults,notion_status:'検証用'},canEdit:true}});
 });
 await page.route('**/api/staff/interviews/history?*',route=>route.fulfill({json:{events:[]}}));
 await page.route('**/api/staff/interviews/bensuke-review?*',route=>route.fulfill({json:{id:'booking',version:1,local:appointment,remote:{title:'確認用',date:{start:today+'T13:00',end:today+'T13:45'},campuses:['本校'],room:'',tags:[]},teacherNames:['架空講師'],editedAt:'test',canAdopt:true,changed:true,issue:''}}));
 await page.goto('/staff/interviews');
}
test('面談：確認から一つ戻っても入力・チェックが残り、保存は発生しない',async({page})=>{
 let writes=0;await interviews(page,()=>{writes++;return false;});await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'面談を登録',exact:true}).click();
 const input=page.getByRole('dialog',{name:'面談予定の入力'});
 await input.getByRole('combobox',{name:/^生徒/}).selectOption(student.id);
 await input.getByLabel('事前相談・メモ').fill('戻っても残るメモ');
 await input.getByLabel('自動作成枠以外の場合、担当講師の勤務・開校状況を確認しました').check();
 await input.getByRole('button',{name:'内容を確認',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(1);
 await page.getByRole('dialog',{name:'保存前の確認'}).getByRole('button',{name:'← 戻る',exact:true}).click();
 await expect(input.getByLabel('事前相談・メモ')).toHaveValue('戻っても残るメモ');
 await expect(input.getByLabel('自動作成枠以外の場合、担当講師の勤務・開校状況を確認しました')).toBeChecked();
 await input.getByRole('button',{name:'内容を確認',exact:true}).click();await page.keyboard.press('Escape');
 await expect(input).toBeVisible();expect(writes).toBe(0);
 await input.locator('fieldset').evaluate(el=>el.parentElement!.parentElement!.scrollTop=10000);
 const back=input.getByRole('button',{name:'← 戻る',exact:true});await expect(back).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'analysis_outputs/line-back/interview-mobile.png',fullPage:true});
 await back.click();await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('面談：通信結果不明でも再試行が画面内にあり、同じ操作番号で一度だけ確定する',async({page})=>{
 const writes:Record<string,unknown>[]=[];await interviews(page,body=>{writes.push(body);return writes.length===1;});
 await page.getByRole('button',{name:'面談を登録',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'面談予定の入力'});
 await dialog.getByRole('combobox',{name:/^生徒/}).selectOption(student.id);await dialog.getByRole('button',{name:'内容を確認',exact:true}).click();
 await page.getByRole('dialog',{name:'保存前の確認'}).getByRole('button',{name:'保存する',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'面談予定の入力'});
 await expect(dialog.getByRole('button',{name:'← 戻る',exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('事前相談・メモ')).toBeDisabled();
 await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'保存結果を確認・再試行'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toHaveLength(2);expect(writes[1].operationKey).toBe(writes[0].operationKey);
});
for(const [button,label,confirm] of [
 ['変更','面談予定の入力','内容を確認'],
 ['取消・状態の変更','面談の状態変更','予約を取り消す'],
 ['実施済み・記録入力','面談記録','下書き保存'],
 ['予約枠の設定','予約枠の設定','設定を保存'],
 ['Notionとの差分を確認','Notionとの差分','Notionの変更を取り込む'],
 ['変更履歴','変更履歴',''],
] as const)test(`面談：${label}の往復`,async({page})=>{
 let writes=0;await interviews(page,()=>{writes++;return false;});await page.getByRole('button',{name:button,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:label,exact:true});await expect(dialog).toBeVisible();
 if(label==='面談予定の入力'){
  await dialog.getByLabel('変更理由',{exact:true}).fill('変更の確認');
  await dialog.getByLabel('変更後の日時についてNotionの既存予定・担当講師の対応可否を確認しました').check();
 }
 if(label==='面談の状態変更')await dialog.getByLabel('変更・取消・見送りの理由').fill('取消の確認');
 if(label==='面談記録')await dialog.getByLabel('面談内容',{exact:true}).fill('記録が残る');
 if(label==='Notionとの差分')await dialog.getByRole('checkbox').check();
 if(confirm){await dialog.getByRole('button',{name:confirm,exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);await page.getByRole('dialog',{name:'保存前の確認'}).getByRole('button',{name:'← 戻る',exact:true}).click();await expect(dialog).toBeVisible();}
 await dialog.getByRole('button',{name:'← 戻る',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(0);
});
test('自習室：確認→日時・席→予約状況→再開で選択を保持する',async({page})=>{
 await session(page);let writes=0;
 await page.route('**/api/staff/study-room-trial/student?*',route=>route.fulfill({json:{requests:[],booked:[],closedSlotIds:[]}}));
 await page.route('**/api/staff/study-room-trial/student',route=>{writes++;return route.abort();});
 await page.setViewportSize({width:390,height:844});await page.goto('/self-study-room/trial?staff=KUDO');
 await page.getByRole('button',{name:'16:45–18:15 空きあり',exact:true}).click();await page.getByRole('button',{name:'3番席',exact:true}).click();
 await page.getByRole('button',{name:'申請内容を確認する'}).click();await page.getByRole('button',{name:'← 日時・席の選択に戻る'}).click();
 await expect(page.getByRole('button',{name:'3番席',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'← 予約状況に戻る'}).click();await expect(page.getByRole('button',{name:'申請内容を確認する'})).toHaveCount(0);
 await page.getByRole('button',{name:'入力を再開する'}).click();await expect(page.getByRole('button',{name:'3番席',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'↑ 時間帯の選択に戻る'}).click();await expect(page.getByRole('heading',{name:'時間帯を選ぶ',exact:true})).toBeFocused();
 await page.screenshot({path:'analysis_outputs/line-back/study-mobile.png',fullPage:true});expect(writes).toBe(0);
});
test('予約メニュー→自習室→メニューへ戻れ、面談希望の確認から入力に戻れる',async({page})=>{
 await session(page);
 await page.route('**/api/staff/study-room-trial/student?*',route=>route.fulfill({json:{requests:[],booked:[],closedSlotIds:[]}}));
 let writes=0;
 await page.route('**/api/staff/interview-trial/*',route=>{
  if(route.request().method()==='POST'){writes++;return route.abort();}
  return route.fulfill({json:readInterviewTrial({rows:[],operations:[],events:[]},{staffId:'test',staffCode:'KUDO',displayName:'検証職員',role:'admin'},'student')});
 });
 await page.goto('/reservations/trial?staff=KUDO');await page.getByRole('link',{name:/自習室予約/}).click();
 await page.getByRole('link',{name:'← 予約メニューに戻る'}).click();await page.getByRole('link',{name:/面談予約/}).click();
 await page.getByLabel('第1希望の時間').selectOption(`${trialDay(3)}|本校|13:00`);
 await page.getByLabel('相談内容・連絡事項').fill('希望を残す');await page.getByRole('button',{name:'申請内容を確認',exact:true}).click();
 await page.getByRole('dialog',{name:'操作内容の確認'}).getByRole('button',{name:'← 戻る'}).click();
 await expect(page.getByLabel('相談内容・連絡事項')).toHaveValue('希望を残す');
 await expect(page.getByLabel('第1希望の時間')).toHaveValue(`${trialDay(3)}|本校|13:00`);expect(writes).toBe(0);
 await page.goto('/staff/interviews/trial');await page.getByRole('link',{name:'← 面談の予定に戻る'}).click();await expect(page).toHaveURL(/\/staff\/interviews\?staff=KUDO$/);
});

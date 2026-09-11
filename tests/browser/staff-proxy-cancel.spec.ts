import {test,expect,type Page} from '@playwright/test';
import {getJapanDate} from '../../src/lib/reservation-date.mjs';

async function setup(page:Page,{loseResponse=false,forbid=false,conflict=false}={}){
 const date=getJapanDate();let loggedIn=true;
 const operations:Record<string,unknown>[]=[];
 const calls:string[]=[];
 const target={id:'target',student_name:'取消対象の生徒',student_number:'CANCEL001',grade:'中1',reservation_date:date,seat:3,slot_ids:['16:45-18:15','18:35-20:05'],status:'approved',version:2,intake_channel:'line_screen'};
 const other={...target,id:'other',student_name:'別の生徒',student_number:'OTHER001',seat:4};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());calls.push(url.pathname+url.search);
  if(url.pathname==='/api/staff/session')return route.fulfill({status:loggedIn?200:401,json:loggedIn?{staff:{staffId:'proxy-test',staffCode:'KUDO',displayName:'検証職員',role:'admin'}}:{error:'ログインしてください。'}});
  if(!loggedIn)return route.fulfill({status:401,json:{error:'ログインしてください。'}});
  if(url.pathname.endsWith('/intake-options'))return route.fulfill({json:{date,slotIds:['16:45-18:15','18:35-20:05','20:25-21:55'],booked:[],closedSlotIds:[]}});
  if(url.pathname.endsWith('/requests')){
   const searching=!url.searchParams.has('status');const second=Number(url.searchParams.get('offset'))>0;
   return route.fulfill({json:{requests:searching?(second?[target]:[other]):[],hasMore:searching&&!second,permissions:{'study_room.cancel':!forbid,'study_room.submit':true}}});
  }
  if(url.pathname.endsWith('/transition')){
   if(conflict)return route.fulfill({status:409,json:{error:'予約の状況が変わりました。もう一度検索してください。'}});
   const operation=route.request().postDataJSON();operations.push(operation);target.status='cancelled';
   if(loseResponse&&operations.length===1)return route.abort('connectionreset');
   return route.fulfill({json:{request:target}});
  }
  throw new Error('Unexpected endpoint: '+url.pathname);
 });
 await page.goto('/staff/self-study-room/trial?staff=KUDO');
 await page.getByRole('button',{name:'電話などで受けた予約の申請・取消',exact:true}).click();
 return {operations,calls,target,other,expire:()=>{loggedIn=false;}};
}
async function findReservation(page:Page){
 await page.getByRole('button',{name:'予約を取り消す',exact:false}).click();
 const panel=page.getByRole('region',{name:'職員による代理取消'});
 await panel.getByLabel('取消する生徒の氏名・学籍番号').fill('取消対象');
 await panel.getByRole('button',{name:'予約を探す',exact:true}).click();
 await expect(panel.getByText('3番席',{exact:true})).toBeVisible();
 await expect(panel.getByText(/別の生徒/)).toHaveCount(0);
 await panel.getByRole('button',{name:'この予約の取消へ'}).click();
 await panel.getByLabel('取消依頼の内容（必須）').fill('保護者から都合が悪くなったため取消の依頼');
 return panel;
}
test('proxy cancellation finds the student across pages and retries the same operation',async({page})=>{
 const state=await setup(page,{loseResponse:true});
 const panel=await findReservation(page);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await panel.screenshot({path:'analysis_outputs/proxy-cancel-20260911.png'});
 await panel.getByRole('button',{name:'取消を確定する'}).click();
 await expect(panel.getByRole('button',{name:'同じ取消の結果を再確認'})).toBeVisible();
 await expect(page.getByRole('button',{name:'予約を申し込む',exact:false})).toBeDisabled();
 await expect(page.getByRole('button',{name:'代理受付を閉じる',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'同じ取消の結果を再確認'}).click();
 await expect(panel.getByRole('status')).toHaveText('生徒の代わりに取消を保存しました。');
 expect(state.operations).toHaveLength(2);expect(state.operations[0]).toEqual(state.operations[1]);
 expect(state.operations[0]).toMatchObject({requestId:'target',expectedVersion:2,action:'cancel',reason:'電話で受けた代理取消：保護者から都合が悪くなったため取消の依頼'});
 expect(state.other.status).toBe('approved');
 expect(state.calls.some(call=>call.includes('offset=50'))).toBe(true);
 await expect(panel.getByRole('button',{name:'この予約の取消へ'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'予約を申し込む',exact:false})).toBeEnabled();
});
test('proxy purposes respect cancellation permission',async({page})=>{
 await setup(page,{forbid:true});
 await expect(page.getByRole('button',{name:'予約を取り消す',exact:false})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'予約を申し込む',exact:false})).toBeVisible();
});
test('stale proxy cancellation clears the target and requires a new search',async({page})=>{
 const state=await setup(page,{conflict:true});const panel=await findReservation(page);
 await panel.getByRole('button',{name:'取消を確定する'}).click();
 await expect(page.getByText('予約の状況が変わりました。もう一度検索してください。')).toBeVisible();
 await expect(panel.getByRole('form',{name:'代理取消の確認'})).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'この予約の取消へ'})).toHaveCount(0);
 expect(state.operations).toHaveLength(0);expect(state.target.status).toBe('approved');
});
test('expired session removes proxy cancellation details',async({page})=>{
 const state=await setup(page);const panel=await findReservation(page);state.expire();
 await panel.getByRole('button',{name:'取消を確定する'}).click();
 await expect(page.getByRole('region',{name:'職員による代理取消'})).toHaveCount(0);
 await expect(page.getByText(/取消対象の生徒/)).toHaveCount(0);expect(state.operations).toHaveLength(0);
});

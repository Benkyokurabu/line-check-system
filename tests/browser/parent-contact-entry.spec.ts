import {test,expect} from '@playwright/test';
for(const width of [1280,390])test(`アンケートのない見学生を選び業務記録を保存・再開 ${width}px`,async({page})=>{
 const student={id:'22222222-2222-4222-8222-222222222222',name:'見本の見学生',number:'2026000',campus:'南教室',grade:'中１',status:'見学中'};
 const options={month:'2026-10',file:{name:'004 担任業務記録簿2026年10月 対保護者.xlsx',url:'https://onedrive.live.com/edit'},teachers:['工藤先生'],tasks:['保護者面談'],contents:['見学打合せ'],results:['経過観察']};
 let entry:Record<string,unknown>|null=null,expired=false;const saves:Array<Record<string,unknown>>=[];
 await page.setViewportSize({width,height:950});await page.route('**/api/staff/session',r=>r.fulfill({json:{staff:{staffId:'44444444-4444-4444-8444-444444444444',staffCode:'KUDO',role:'admin',displayName:'工藤'}}}));
 await page.route('**/api/staff/parent-contact*',r=>{
  const url=new URL(r.request().url());
  if(url.searchParams.has('q'))return r.fulfill({json:{students:[student],hasMore:false}});
  if(url.searchParams.has('month'))return r.fulfill({json:options});
  if(r.request().method()==='POST'){
   const b=r.request().postDataJSON();saves.push(b);
   if(!expired){expired=true;return r.fulfill({status:401,json:{error:'ログインを再確認してください'}});}
   entry={id:b.id,version:b.version+1,status:'complete',payload:{studentPageId:student.id,studentName:student.name,studentNumber:student.number,workLog:b.workLog,fields:{date:{value:b.date}}},targets:{workLog:{status:'synced',file:options.file.name,row:80,url:options.file.url}}};
   return r.fulfill({json:{entry}});
  }
  return r.fulfill({json:url.searchParams.has('entry')?{entry}:{entries:entry?[entry]:[]}});
 });
 await page.goto('/staff/parent-contact');await page.getByLabel('生徒名',{exact:true}).fill('見本');await page.getByRole('button',{name:'生徒を探す',exact:true}).click();await page.getByRole('button',{name:/見本の見学生.*見学中/}).click();
 await page.getByLabel('業務記録の実施日',{exact:true}).fill('2026-10-19');await page.getByLabel('業務記録の氏名',{exact:true}).selectOption('工藤先生');await page.getByLabel('業務記録の摘要',{exact:true}).selectOption('保護者面談');await page.getByLabel('業務記録の開始時刻',{exact:true}).fill('16:05');await page.getByLabel('業務記録の終了時刻',{exact:true}).fill('16:40');await page.getByLabel('業務記録の生徒名・相手',{exact:true}).fill('中１ 見本の見学生+母');await page.getByLabel('業務記録の内容',{exact:true}).selectOption('見学打合せ');await page.getByLabel('業務記録の結果',{exact:true}).selectOption('経過観察');
 const save=()=>page.getByRole('button',{name:'保存してOneDriveの業務記録簿へ反映',exact:true}).click();
 await save();await expect(page.getByRole('button',{name:'ログイン状態を再確認する',exact:true})).toBeVisible();await page.getByRole('button',{name:'ログイン状態を再確認する',exact:true}).click();await expect(page.getByLabel('業務記録の開始時刻',{exact:true})).toHaveValue('16:05');await save();
 await expect(page.getByText(/入力シート 80行目/)).toBeVisible();expect(saves).toHaveLength(2);expect(saves[0].operationKey).toBe(saves[1].operationKey);expect(saves[1]).toMatchObject({studentPageId:student.id,date:'2026-10-19',intent:'reflect',workLog:{content:'見学打合せ',contact:'中１ 見本の見学生+母'}});
 await page.reload();await page.getByText('保存済みの業務記録を再開',{exact:true}).click();await page.getByRole('button',{name:/2026-10-19.*見本の見学生/}).click();await expect(page.getByLabel('業務記録の終了時刻',{exact:true})).toHaveValue('16:40');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`analysis_outputs/post-interview/parent-entry-${width}.png`,fullPage:true});
});

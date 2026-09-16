import {test,expect} from '@playwright/test';
const pageId='11111111111141118111111111111111';
const groups=[{teacher:'工藤',students:[{grade:'中3',name:'保存確認生徒',notionUrl:`https://app.notion.com/p/${pageId}`,submittedAt:'2026-09-16T00:00:00Z'}]}];
test('保存するまで共有されず、保存後は別端末に反映。未確認への変更も共有する',async({browser})=>{
 let states:{page_id:string;confirmed:boolean;version:number}[]=[];let fail=false;
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 for(const c of contexts){
  await c.route('**/api/interview-surveys',r=>r.fulfill({json:{groups}}));
  await c.route('**/api/interview-surveys/confirmations',r=>{
   if(r.request().method()==='POST'){
    if(fail)return r.fulfill({status:503,json:{error:'保存できませんでした。変更を残しています。'}});
    const change=r.request().postDataJSON().changes[0];states=[{page_id:change.pageId,confirmed:change.confirmed,version:change.version+1}];return r.fulfill({json:{saved:true}});
   }return r.fulfill({json:{states}});
  });
 }
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
 for(const p of [a,b]){await p.goto('/');await p.getByRole('button',{name:'工藤先生 1'}).click();await expect(p.getByRole('button',{name:'未確認',exact:true})).toBeEnabled();}
 await a.getByRole('button',{name:'未確認',exact:true}).click();expect(states).toHaveLength(0);
 await expect(b.getByRole('button',{name:'未確認',exact:true})).toBeVisible();
 fail=true;await a.getByRole('button',{name:'確認状態を保存'}).click();await expect(a.getByText('保存できませんでした。変更を残しています。',{exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();
 fail=false;await a.getByRole('button',{name:'確認状態を保存'}).click();await expect(a.getByText('確認状態を保存しました。他の先生にも共有されます。',{exact:true})).toBeVisible();
 await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(b.getByRole('button',{name:'確認済み',exact:true})).toBeVisible();
 await b.getByRole('button',{name:'確認済み',exact:true}).click();await b.getByRole('button',{name:'確認状態を保存'}).click();await expect(b.getByText('確認状態を保存しました。他の先生にも共有されます。',{exact:true})).toBeVisible();
 await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(a.getByRole('button',{name:'未確認',exact:true})).toBeVisible();
 await Promise.all(contexts.map(c=>c.close()));
});
test('未認証・他サイトからの保存は拒否する',async({request})=>{
 expect((await request.post('/api/interview-surveys/confirmations',{headers:{origin:'https://other.invalid'},data:{changes:[]}})).status()).toBe(403);
 expect((await request.post('/api/interview-surveys/confirmations',{headers:{origin:'https://test.invalid'},data:{changes:[]}})).status()).toBe(401);
});

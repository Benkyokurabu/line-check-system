import {test,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

function pdfFixture(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length 40 >>\nstream\nBT /F1 12 Tf 40 750 Td (Fixture) Tj ET\nendstream'];
 let text='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return text;
}
for(const initial of ['queued','running','failed','broken-pdf','changed-source'] as const){
 test(`AI ${initial}: saves every file to disk and uses HTML offline`,async({page,browser},testInfo)=>{
  const root=resolve('analysis_outputs/offline-folder-verification',`${testInfo.workerIndex}-${initial}-${Date.now()}`);
  const folder='確認用 生徒_2018998';await mkdir(root,{recursive:true});
  let status:string=['broken-pdf','changed-source'].includes(initial)?'queued':initial;let sourceHash='source-v1';let contextReads=0;
  const summary=()=>({status,sourceHash,items:status==='completed'?[{note:'自動追加した注意点',source:'備考',original:'原文'}]:[]});
  await page.exposeBinding('folderRead',async(_,directory:string,name:string)=>{
   const path=resolve(root,directory,name);if(!path.startsWith(root+sep))throw Error('Path escaped');return Array.from(await readFile(path));
  });
  await page.exposeBinding('folderWrite',async(_,directory:string,name:string,bytes:number[])=>{
   const path=resolve(root,directory,name);if(!path.startsWith(root+sep))throw Error('Path escaped');await mkdir(resolve(root,directory),{recursive:true});await writeFile(path,Buffer.from(bytes));
  });
  await page.addInitScript(({folder})=>{
   const win=window as unknown as {folderRead:(directory:string,name:string)=>Promise<number[]>;folderWrite:(directory:string,name:string,bytes:number[])=>Promise<void>};
   const directory=(name:string):unknown=>({getDirectoryHandle:async(child:string)=>directory(child),getFileHandle:async(file:string)=>({
    getFile:async()=>new Blob([new Uint8Array(await win.folderRead(name,file))]),
    createWritable:async()=>({write:async(value:string|Blob)=>{const blob=typeof value==='string'?new Blob([value]):value;await win.folderWrite(name,file,Array.from(new Uint8Array(await blob.arrayBuffer())));},close:async()=>{}})
   })});
   Object.defineProperty(window,'showDirectoryPicker',{value:async(options:{id:string})=>directory(options.id.endsWith('-update')?folder:'')});
  },{folder});
  await page.route('**/api/staff/session',route=>route.fulfill({json:{staff:{role:'admin'}}}));
  await page.route('**/api/admin/teachers',route=>route.fulfill({json:{teachers:[]}}));
  await page.route('**/api/staff/interview-materials',route=>route.fulfill({json:{students:[{number:'2018998',name:'確認用 生徒',grade:'中3',teacher:'工藤',responses:[]}]}}));
  await page.route('**/api/staff/interview-material-context**',route=>{contextReads++;return route.fulfill({json:{studentNumber:'2018998',capturedAt:new Date().toISOString(),records:[{id:'record',date:'2026-05-23',title:'進路相談',body:'保存した面談記録の全文',url:'https://notion.so/record'}],info:[{source:'備考',value:'保存した生徒情報の原文'}],summary:summary(),studentUrl:'https://notion.so/student',source:'notion'}});});
  await page.route('**/api/staff/interview-material-info**',route=>route.fulfill({json:route.request().method()==='POST'?{status:'queued'}:{summary:summary()}}));
  await page.route('https://fixture.invalid/*.pdf',route=>route.fulfill({body:initial==='broken-pdf'?'Not a PDF':pdfFixture(),contentType:'application/pdf',headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('**/api/staff/interview-material-jobs**',route=>{
   if(route.request().method()==='POST')return route.fulfill({status:201,json:{id:route.request().postDataJSON().kind}});
   const id=new URL(route.request().url()).searchParams.get('id');
   if(!id)return route.fulfill({json:{available:[{id:'primary',priority:1}]}});
   return route.fulfill({json:{job:id==='preview'?{status:'completed',result:{schools:[],materials:[{id:'guide',label:'指導簿',group:'生徒本人の資料',detail:'本人の資料',staffOnly:false}]}}:{status:'completed',pdfUrl:'https://fixture.invalid/bundle.pdf',result:{items:[{label:'指導簿',source:'guide',previewUrl:'https://fixture.invalid/guide.pdf',staffOnly:false}],missing:[],pages:1}}}});
  });
  await page.goto('/staff/interview-materials');await page.getByRole('button',{name:/中3 確認用 生徒/}).click();
  await page.getByRole('button',{name:'資料を作る',exact:true}).click();await page.getByRole('button',{name:'選んだ1点でPDFを作成'}).click();
  await page.getByRole('button',{name:/PCに保存/}).click();await page.getByRole('button',{name:/面談用フォルダを保存/}).click();
  if(initial==='broken-pdf'){await expect(page.getByRole('status').filter({hasText:'を取得できませんでした'})).toBeVisible();expect(await readFile(resolve(root,folder,'面談資料.html')).catch(()=>null)).toBeNull();return;}
  expect(contextReads).toBe(1);
  await expect(page.getByRole('status').filter({hasText:'ネット接続なしで資料・面談記録・生徒情報'})).toBeVisible();
  for(const name of ['material-0.pdf','staff-bundle.pdf','面談資料.html','面談記録.txt','生徒情報・注意点.txt','AI要約.js','保存情報.json','資料一覧.txt'])expect((await readFile(resolve(root,folder,name))).length).toBeGreaterThan(0);
  const offlineContext=await browser.newContext();await offlineContext.setOffline(true);const offline=await offlineContext.newPage();let remote=0;
  offline.on('request',request=>{if(/^https?:/.test(request.url()))remote++;});
  await offline.goto(pathToFileURL(resolve(root,folder,'面談資料.html')).href);
  await offline.getByRole('button',{name:'資料を画面で見る'}).click();await offline.getByRole('button',{name:'面談記録を表示'}).click();
  await expect(offline.getByText('保存した面談記録の全文')).toBeVisible();
  await offline.getByRole('button',{name:'情報を表示'}).click();await expect(offline.getByText('保存した生徒情報の原文')).toBeVisible();
  if(initial==='changed-source'){sourceHash='source-v2';status='completed';await expect(page.getByRole('status').filter({hasText:'元の記録が更新されたため'})).toBeVisible({timeout:15000});expect(await readFile(resolve(root,folder,'AI要約.js'),'utf8')).not.toContain('自動追加した注意点');}
  else if(initial!=='failed'){
   status='completed';await expect.poll(async()=>await readFile(resolve(root,folder,'AI要約.js'),'utf8'),{timeout:15000}).toContain('自動追加した注意点');
   await expect(offline.getByText('自動追加した注意点')).toBeVisible({timeout:10000});
  }else{
   status='completed';await page.getByRole('button',{name:'保存済みフォルダのAI要約を更新',exact:true}).click();
   await expect(page.getByRole('status').filter({hasText:'PDFを保存し直す必要はありません'})).toBeVisible();
   await expect(offline.getByText('自動追加した注意点')).toBeVisible({timeout:10000});
  }
  expect(remote).toBe(0);await offline.screenshot({path:resolve(root,'offline-html.png')});await offlineContext.close();
 });
}

test('folder design explains post-save updates and works on a small screen',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(pathToFileURL(resolve('docs/interview-folder-design-20261002.html')).href);
 await page.getByRole('button',{name:'① フォルダを保存'}).click();
 await page.getByRole('button',{name:'② AI要約が完成'}).click();
 await expect(page.getByRole('status')).toContainText('同じフォルダのAI要約を更新');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'analysis_outputs/interview-folder-design-mobile.png',fullPage:true});
});

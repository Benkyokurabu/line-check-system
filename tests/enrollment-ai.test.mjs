import {test} from 'node:test';import assert from 'node:assert/strict';import {draftEnrollmentRecord,transcribeEnrollmentAudio} from '../src/lib/enrollment-ai.mjs';
test('音声を日本語で認識し、認識結果以外を返さない',async()=>{
 const file=new File([new Uint8Array(500)],'speech.webm',{type:'audio/webm'});
 const text=await transcribeEnrollmentAudio(file,{key:'test',fetcher:async(url,init)=>{assert.match(url,/audio\/transcriptions$/);assert.equal(init.body.get('language'),'ja');return Response.json({text:'入塾日は10月20日です。'});}});assert.equal(text,'入塾日は10月20日です。');
 await assert.rejects(()=>transcribeEnrollmentAudio(new File([new Uint8Array(3_000_001)],'large.webm',{type:'audio/webm'}),{key:'test'}),/3MB/);
});
test('文章の生成と項目候補を分け、根拠の引用を確認し人の判断待ちで返す',async()=>{
 const d=await draftEnrollmentRecord('本人は英語を受講します。',{key:'test',fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({record:'本人が英語を受講する。',fields:{classes:{value:'２Ａ英',source:'本人は英語を受講します。'}}})}}]})});assert.equal(d.fields.classes.state,'review');assert.equal(d.record,'本人が英語を受講する。');assert.equal('mtg' in d,false);
});

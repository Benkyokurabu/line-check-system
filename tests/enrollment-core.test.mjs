import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankEnrollmentFields,validateEnrollmentPayload,desiredEnrollmentProperties,safePropertyPatch,propertyComparable,seedEnrollmentFields,checkedEnrollmentAI,pendingEnrollmentFields} from '../src/lib/enrollment-core.mjs';
const student='11111111-1111-4111-8111-111111111111';
const payload=()=>({studentPageId:student,intakePageId:'',fields:blankEnrollmentFields(),record:'手続きの記録',sourceText:''});
const date=name=>({id:name,type:'date'});

test('Notionのstatusを比較し、面談準備の競合は上書きしない',()=>{const before={status:{id:'todo'}},after={status:{id:'done'}};assert.deepEqual(propertyComparable(before),{status:'todo'});assert.deepEqual(safePropertyPatch({properties:{面談準備:before}},{面談準備:after},{面談準備:{status:'todo'}}),{面談準備:after});assert.throws(()=>safePropertyPatch({properties:{面談準備:{status:{id:'other'}}}},{面談準備:after},{面談準備:{status:'todo'}}),/面談準備/);});
test('生徒情報にシステム日時やURLが混在しても読み取れる',async()=>{const {propertyText}=await import('../src/lib/enrollment-core.mjs');assert.equal(propertyText({type:'last_edited_time',last_edited_time:'2026-10-17T00:00:00Z'}),'2026-10-17T00:00:00Z');assert.equal(propertyText({type:'rollup',rollup:{array:[{type:'formula',formula:{string:'中2'}}]}}),'中2');});
test('入塾日・手続き日を区別し、未入力で既存値を消さない',()=>{
 const p=payload();p.fields.procedureDate={value:'2026-10-17',state:'confirmed'};const checked=validateEnrollmentPayload(p);
 const result=desiredEnrollmentProperties(checked,'student',{properties:{'入塾手続日':date('procedure'),'本当の入塾日':date('admission')}});
 assert.deepEqual(result,{'入塾手続日':{date:{start:'2026-10-17'}}});assert.ok(pendingEnrollmentFields(checked).some(f=>f.key==='admissionDate'));
 p.fields.admissionDate={value:'2026-10-20',state:'confirmed'};assert.equal(desiredEnrollmentProperties(validateEnrollmentPayload(p),'student',{properties:{'入塾手続日':date('p'),'本当の入塾日':date('a')}})['本当の入塾日'].date.start,'2026-10-20');
});
test('未実施・済・未確認を区別し、未確認の既存チェックをfalseで上書きしない',()=>{
 const p=payload();const schema={properties:{'入塾申込書':{type:'checkbox'}}};
 assert.deepEqual(desiredEnrollmentProperties(p,'intake',schema),{});
 p.fields.documents={state:'confirmed',value:'未実施'};assert.deepEqual(desiredEnrollmentProperties(p,'intake',schema),{'入塾申込書':{checkbox:false}});
});
test('終業MTGは面談メンションと詳細はこちらのみ',()=>{
 const result=desiredEnrollmentProperties(payload(),'mtg',{properties:{'見出し':{type:'rich_text'},'面談目的':{type:'multi_select',multi_select:{options:[{name:'入会手続き',id:'purpose'}]}}}},'actor','interview');
 assert.deepEqual(result['内容'],{title:[{type:'mention',mention:{type:'page',page:{id:'interview'}}},{type:'text',text:{content:' 詳細はこちら'}}]});assert.equal(result['内容'].title.length,2);
});
test('他の職員が変えた値は上書きせず、更新済みと同値なら再実行しても書かない',()=>{
 const before={date:{start:'2026-10-17'}};const next={date:{start:'2026-10-20'}};
 assert.throws(()=>safePropertyPatch({properties:{'本当の入塾日':{date:{start:'2026-10-19'}}}},{'本当の入塾日':next},{'本当の入塾日':propertyComparable(before)}),/変更/);
 assert.deepEqual(safePropertyPatch({properties:{'本当の入塾日':next}},{'本当の入塾日':next},{'本当の入塾日':propertyComparable(before)}),{});
});
test('AI候補は人の確認待ちとし、根拠のない引用は採用しない',()=>{
 const d=checkedEnrollmentAI({record:'説明した。',fields:{admissionDate:{value:'2026-10-20',source:'入塾日は20日'},photo:{value:'済',source:'撮影しました'}}},'入塾日は20日との発言。写真は未撮影。');
 assert.equal(d.fields.admissionDate.state,'review');assert.equal(d.fields.photo.source,'');assert.match(d.fields.photo.reason,/根拠/);
});
test('不正日付・未入力を確定した値・未知の確認状態を拒否する',()=>{
 const p=payload();p.fields.admissionDate={value:'2026-02-31',state:'confirmed'};assert.throws(()=>validateEnrollmentPayload(p));
 p.fields.admissionDate={value:'',state:'confirmed'};assert.throws(()=>validateEnrollmentPayload(p));p.fields.admissionDate={value:'2026-10-17',state:'automatic'};assert.throws(()=>validateEnrollmentPayload(p));
});
test('既存の入塾日を使い、未チェックを未実施と決めつけない',()=>{
 const r=seedEnrollmentFields({properties:{'本当の入塾日':{type:'date',date:{start:'2026-10-20'}},'学年':{type:'formula',formula:{string:'中2'}}}},{properties:{'入塾申込書':{type:'checkbox',checkbox:false}}});
 assert.equal(r.admissionDate.value,'2026-10-20');assert.equal(r.grade.value,'中２');assert.equal(r.documents.state,'unknown');
});

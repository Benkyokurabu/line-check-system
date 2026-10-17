import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {runPostNotion} from '../src/lib/post-interview-notion.mjs';import {blankPostFields,RECORD_SOURCE} from '../src/lib/post-interview-core.mjs';import {propertyBaseline} from '../src/lib/enrollment-notion.mjs';
const student=randomUUID(),answer=randomUUID(),source=randomUUID();
function fixture({existing=false,loseCreate=false,loseAppend=false}={}){
 let page=existing?{id:randomUUID(),url:'https://notion.invalid/record',parent:{data_source_id:RECORD_SOURCE},properties:{面談内容:{title:[{text:{content:'面談の見出し'}}]},面談日:{date:{start:'2026-10-17'}},生徒情報DB:{relation:[{id:student}]}}}:null;
 let blocks=existing?[{id:'legacy-block',type:'paragraph',last_edited_time:'initial',paragraph:{rich_text:[{text:{content:'既存の本文'}}]}}]:[];
 const calls=[];const schema={properties:{面談内容:{type:'title'},面談日:{type:'date'},生徒情報DB:{type:'relation'}}};const survey={id:answer,parent:{data_source_id:source},properties:{生徒情報DB:{relation:[{id:student}]},対応:{select:{id:'todo'}}}};
 const fields=blankPostFields();for(const [key,value]of Object.entries({title:'面談の見出し',date:'2026-10-17',record:existing?'既存の本文':'新しい本文'}))fields[key]={...fields[key],state:'confirmed',value};
 const entry={id:randomUUID(),version:1,payload:{studentPageId:student,answerId:answer,answerSourceId:source,fields,originalBody:existing?'既存の本文':'',surveySchema:{properties:{対応:{type:'select',select:{options:[{id:'done',name:'対応済'}]}}}}},targets:{record:{pageId:page?.id??'',status:'pending',baseline:page?propertyBaseline(page):{}},survey:{status:'pending',baseline:propertyBaseline(survey)},lines:{}}};
 const request=async(path,init={})=>{calls.push({path,method:init.method??'GET'});const data=init.body?JSON.parse(init.body):{};
  if(path==='/data_sources/'+RECORD_SOURCE)return schema;
  if(path.endsWith('/query'))return {results:page?[page]:[],has_more:false};
  if(path==='/pages'&&init.method==='POST'){page={id:randomUUID(),parent:{data_source_id:RECORD_SOURCE},properties:data.properties};blocks=data.children.map((b,i)=>({...b,id:'created-'+i,last_edited_time:'created'}));if(loseCreate){loseCreate=false;throw Error('lost response');}return page;}
  if(path==='/pages/'+answer){if(init.method==='PATCH')Object.assign(survey.properties,data.properties);return survey;}
  if(path==='/pages/'+page?.id){if(init.method==='PATCH')Object.assign(page.properties,data.properties);return page;}
  if(path.startsWith('/blocks/'+page?.id+'/children')){if(init.method==='PATCH'){blocks.push(...data.children.map((b,i)=>({...b,id:'append-'+i,last_edited_time:'append'})));if(loseAppend){loseAppend=false;throw Error('lost append');}}return {results:blocks,has_more:false};}
  throw Error('Unexpected request '+path);
 };
 return {entry,request,calls,checkpoint:async()=>true,get page(){return page;},get blocks(){return blocks;},survey};
}
test('新規登録の応答が失われてもマーカーから回復し二重作成しない',async()=>{const f=fixture({loseCreate:true});await runPostNotion(f);assert.equal(f.entry.targets.record.status,'retry');await runPostNotion(f);assert.equal(f.entry.targets.record.status,'synced');assert.equal(f.calls.filter(c=>c.path==='/pages'&&c.method==='POST').length,1);});
test('既存段落と同じ本文を二重追記せず、未確認の対応は書き換えない',async()=>{const f=fixture({existing:true});await runPostNotion(f);assert.equal(f.entry.targets.record.status,'synced');assert.equal(f.blocks.length,1);assert.equal(f.entry.targets.survey.status,'review');assert.equal(f.calls.some(c=>c.path==='/pages/'+answer&&c.method==='PATCH'),false);});
test('変更本文は原本を保持して保存版を追記し、応答喪失後も重ねない',async()=>{const f=fixture({existing:true,loseAppend:true});f.entry.payload.fields.record.value='修正した本文';await runPostNotion(f);assert.equal(f.entry.targets.record.status,'retry');await runPostNotion(f);assert.equal(f.entry.targets.record.status,'synced');assert.equal(f.blocks.length,2);assert.equal(f.blocks[0].paragraph.rich_text[0].text.content,'既存の本文');});
test('競合した項目は上書きせず、確認済みの対応だけを反映する',async()=>{const f=fixture({existing:true});f.page.properties['面談内容']={title:[{text:{content:'別の職員による変更'}}]};f.entry.payload.fields.handling={value:'対応済',state:'confirmed'};await runPostNotion(f);assert.equal(f.entry.targets.record.status,'review');assert.equal(f.page.properties['面談内容'].title[0].text.content,'別の職員による変更');assert.equal(f.survey.properties['対応'].select.id,'done');assert.equal(f.entry.targets.survey.status,'synced');});

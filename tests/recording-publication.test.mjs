import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordingAdmin,validRecordingKey,releaseTime,publicationStatus,publicRecordingRules} from '../src/lib/recording-publication.mjs';
import {testRange,recordingRangeSource,recordingProgressSources,progressRow,matchesRecordingProgress,notionReady,rangeMatchesKey} from '../src/lib/recording-notion-core.mjs';
const key='2026-10-01|6:35～8:05|hon|hon_j1_S_math|2';
test('only verified administrators can manage publication',()=>{
 assert.equal(recordingAdmin({staffId:'a',role:'admin'}),true);
 for(const staff of [null,{role:'admin'},{staffId:'a',staffCode:'KUDO',role:'teacher'},{staffId:'a',role:'office'}])assert.equal(recordingAdmin(staff),false);
});

test('Notion release uses either human checkbox and fails closed for unknown or mismatched rows',()=>{
 const source=recordingProgressSources[0];
 const page={id:'test-row',parent:{data_source_id:source.id},properties:{'授業':{title:[{plain_text:'数学 1S'}]},'クラス':{rich_text:[{plain_text:'１Ｓ'}]},'教室':{select:{name:'本校'}},'科目':{select:{name:'数学'}},'欠席なし':{type:'checkbox',checkbox:false},'振替者採点・入力':{type:'checkbox',checkbox:false}}};
 const row=progressRow(page,source);
 assert(matchesRecordingProgress(key,row));assert(!notionReady(key,row));
 for(const field of ['noAbsences','makeupComplete'])assert(notionReady(key,{...row,[field]:true}));
 for(const changed of [{campus:'南教室'},{class:'1A'},{subject:'英語'},{month:'2026-06'}])assert(!notionReady(key,{...row,noAbsences:true,...changed}));
 assert.equal(progressRow({...page,in_trash:true},source),null);
 assert.equal(progressRow({...page,parent:{data_source_id:'another-test'}},source),null);
 const rule={event_key:key,event_keys:[key],mode:'notion',source_url:'https://example.test/private',source_urls:['https://example.test/private']};
 assert.equal(publicationStatus(rule),'hidden');assert.equal(publicationStatus({...rule,notion_ready:false}),'hidden');
 assert.equal(publicRecordingRules([{...rule,notion_ready:true}])[0].url,rule.source_url);
 assert(!JSON.stringify(publicRecordingRules([rule])).includes(rule.source_url));
});

test('test detection trusts lesson title and exact date, ignoring incorrect class selection',()=>{
 const page={id:'range',parent:{data_source_id:recordingRangeSource},properties:{'授業名':{title:[{plain_text:'本１Ｓ数'}]},'校舎':{select:{name:'本校'}},'実施日':{date:{start:'2026-10-01'}},'テスト名':{select:{name:'単元テスト③'}},'クラス':{select:{name:'Ａ'}}}};
 const range=testRange(page);assert.equal(range.group,'hon_j1_S_math');assert(rangeMatchesKey(range,key));
 assert(!rangeMatchesKey(range,key.replace('2026-10-01','2026-10-08')));
 assert(!rangeMatchesKey(range,key.replace('hon_j1_S_math','hon_j1_A_math')));
 assert.equal(testRange({...page,in_trash:true}),null);
 assert.equal(testRange({...page,properties:{...page.properties,'校舎':{select:{name:'南教室'}},'授業名':{title:[{plain_text:'南６Ａ算'}]}}}).group,'minami_e6_A_arith');
});
test('English test titles without a campus use the campus property for exact lesson matching',()=>{
 const page={id:'english-range',parent:{data_source_id:recordingRangeSource},properties:{'授業名':{title:[{plain_text:'１Ａ英'}]},'校舎':{select:{name:'南教室'}},'実施日':{date:{start:'2026-10-09'}},'テスト名':{select:{name:'単元テスト③'}},'クラス':{select:{name:'Ｓ'}}}};
 for(const [title,group] of [['１Ａ英','j1_A_eng'],['２Ａ英','j2_A_eng'],['６Ｓ英 ','e6_S_eng']]){
  const range=testRange({...page,properties:{...page.properties,'授業名':{title:[{plain_text:title}]}}});
  assert.equal(range.group,`minami_${group}`);
  const recordingKey=`2026-10-09|6:35～8:05|minami|minami_${group}|1`;
  assert(rangeMatchesKey(range,recordingKey));
  assert(!rangeMatchesKey(range,recordingKey.replaceAll('minami','hon')));
  assert(!rangeMatchesKey(range,recordingKey.replace('2026-10-09','2026-10-16')));
 }
 assert.equal(testRange({...page,properties:{...page.properties,'校舎':{select:{name:'本校'}}}}).group,'hon_j1_A_eng');
 // A title prefix never overrides the campus property.
 assert.equal(testRange({...page,properties:{...page.properties,'授業名':{title:[{plain_text:'本１Ａ英'}]}}}).group,'minami_j1_A_eng');
 for(const campus of [null,{name:'不明'}])assert.equal(testRange({...page,properties:{...page.properties,'校舎':{select:campus}}}),null);
});
test('recording keys and Japanese release timestamps are validated',()=>{
 assert.equal(validRecordingKey(key),true);assert.equal(validRecordingKey('../../recording'),false);
 assert.equal(releaseTime('2026-10-10T22:00',0),'2026-10-10T13:00:00.000Z');
 for(const date of ['2026-02-30T12:00','2026-10-10T25:00','invalid'])assert.throws(()=>releaseTime(date,0));
 assert.throws(()=>releaseTime('2026-10-10T22:00',Date.parse('2026-10-10T13:00:00Z')));
});
test('server publication boundary cannot expose hidden original URLs',()=>{
 const rule={event_key:key,event_keys:[key],source_url:'https://example.test/private',source_urls:['https://example.test/private'],mode:'scheduled',release_at:'2026-10-10T13:00:00Z',version:1};
 const hidden=publicRecordingRules([rule],Date.parse('2026-10-10T12:59:59Z'));
 assert.equal(hidden[0].status,'hidden');assert.equal(hidden[0].url,'');assert(!JSON.stringify(hidden).includes('https://example.test/private'));
 const released=publicRecordingRules([rule],Date.parse(rule.release_at));assert.equal(released[0].url,rule.source_url);
 assert.equal(publicationStatus({...rule,mode:'private'},Date.parse('2099-01-01')),'hidden');
});

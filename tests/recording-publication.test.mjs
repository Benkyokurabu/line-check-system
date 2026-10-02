import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordingAdmin,validRecordingKey,releaseTime,publicationStatus,publicRecordingRules} from '../src/lib/recording-publication.mjs';
const key='2026-10-01|6:35～8:05|hon|hon_j1_S_math|2';
test('only verified administrators can manage publication',()=>{
 assert.equal(recordingAdmin({staffId:'a',role:'admin'}),true);
 for(const staff of [null,{role:'admin'},{staffId:'a',staffCode:'KUDO',role:'teacher'},{staffId:'a',role:'office'}])assert.equal(recordingAdmin(staff),false);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityStaffCode, matchesAvailabilityPassword } from '../src/lib/availability-teacher-login.mjs';

test('先生IDだけを予約可能枠専用の職員コードへ変換する',()=>{
 assert.equal(availabilityStaffCode('00000000-0000-4000-8000-000000000003'),'AVAIL_00000000000040008000000000000003');
 assert.throws(()=>availabilityStaffCode('KUDO'));
});

test('共通パスワードの誤りを拒否する',()=>{
 assert.equal(matchesAvailabilityPassword('incorrect'),false);
 assert.equal(matchesAvailabilityPassword(''),false);
 assert.equal(matchesAvailabilityPassword(null),false);
});

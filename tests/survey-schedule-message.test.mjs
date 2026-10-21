import test from 'node:test';
import assert from 'node:assert/strict';
import {surveyScheduleMessage} from '../src/lib/survey-schedule-style.mjs';
test('日程確定文は挨拶から結びまで一つの文章とし、曜日と開始・終了を差し込む',()=>{
 assert.equal(surveyScheduleMessage({date:'2026-10-24',time:'14:00',endTime:'14:45',staffName:'工藤',method:'３者Zoom'}),
 'こんにちは。工藤です。\nご連絡ありがとうございます。\n\n面談を以下の日時で確定させていただきたいと思います。\n\n10月24日（土）14:00〜14:45\n\nIDとパスコードは当日お伝えいたします。\nそれではよろしくお願いいたします。');
 const other=surveyScheduleMessage({date:'2026-11-01',time:'09:00',staffName:'金城先生',method:'２者対面'});
 assert.ok(other.startsWith('こんにちは。金城です。'));assert.ok(other.includes('11月1日（日）09:00'));assert.ok(!other.includes('パスコード'));assert.equal(surveyScheduleMessage({date:'2026-02-30'}),'');
 assert.ok(surveyScheduleMessage({date:'2026-10-24',staffCode:'KUDO',staffName:'工藤謙'}).startsWith('こんにちは。工藤です。\nご連絡ありがとうございます。'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {matchSurveyStudent} from '../src/lib/survey-student-match.mjs';
const student={name:'架空　花子',number:'2018001',grade:'中3',teacher:'担当A'};
test('番号の桁不足でも空白を除いた氏名と学年が一意なら照合できる',()=>{
 assert.equal(matchSurveyStudent({name:'架空花子',number:'201800',grade:'中3'},[student]),student);
 assert.equal(matchSurveyStudent({name:'架空 花子',number:'２０１８００１',grade:'中3'},[student]),student);
});
test('別人の番号・同姓同名・別学年を自動で割り当てない',()=>{
 const survey={name:'架空花子',number:'201800',grade:'中3'};
 assert.equal(matchSurveyStudent(survey,[student,{...student,number:'2018002'}]),null);
 assert.equal(matchSurveyStudent({...survey,grade:'中2'},[student]),null);
 assert.equal(matchSurveyStudent(survey,[student,{name:'別人',number:'201800',grade:'中3',teacher:'担当B'}]),null);
});

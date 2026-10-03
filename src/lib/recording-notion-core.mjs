export const recordingProgressSources = [{month:'2026-10',label:'2026.10 単元テスト③',test:'単元テスト③',id:'ff3f0120-80a7-83fd-84d2-87e7b016c6bd'}];
export const recordingRangeSource='1cbf0120-80a7-80a8-b190-000b553d32c6';
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s/g,'').toUpperCase();
const plain = property => (property?.title ?? property?.rich_text ?? []).map(t=>t.plain_text ?? t.text?.content ?? '').join('');
export function progressRow(page, source) {
  if (!page || page.archived || page.is_archived || page.in_trash || page.parent?.data_source_id !== source.id) return null;
  const p=page.properties ?? {};
  if (p['欠席なし']?.type !== 'checkbox' || p['振替者採点・入力']?.type !== 'checkbox') return null;
  return {id:page.id,month:source.month,test:source.label,testName:source.test,lesson:plain(p['授業']),class:plain(p['クラス']),campus:p['教室']?.select?.name ?? '',subject:p['科目']?.select?.name ?? '',noAbsences:p['欠席なし'].checkbox === true,makeupComplete:p['振替者採点・入力'].checkbox === true};
}
export function matchesRecordingProgress(key, row) {
  if (!row || key.slice(0,7)!==row.month) return false;
  const [, ,campus,group]=key.split('|');
  const match=/^(hon|minami)_([je])(\d)_([A-Za-z0-9]+)_(math|arith|eng|jp|sci|soc)$/.exec(group ?? '');
  if (!match || match[1] !== campus) return false;
  const subject={math:['数学'],arith:['算数'],eng:['英語'],jp:['国語'],sci:['理科'],soc:['社会']}[match[5]];
  return row.campus === (campus==='hon'?'本校':'南教室') && normalized(row.class)===normalized(match[3]+match[4]) && subject.includes(row.subject);
}
export function notionReady(key,row) { return matchesRecordingProgress(key,row) && (row.noAbsences === true || row.makeupComplete === true); }
// Dates can differ between campuses sharing the same grade/class/subject/test.
export function sharedProgressState(key, row, progress, ranges) {
 if (!matchesRecordingProgress(key,row) || !row.testName) return {ready:false,checks:[],error:'対象の進捗行を確認できません。'};
 const [, ,campus,group]=key.split('|'),suffix=group.replace(/^(hon|minami)_/,'');
 const expected=new Set([campus]);
 for(const range of ranges)if(normalized(range.test)===normalized(row.testName)&&range.group.replace(/^(hon|minami)_/,'')===suffix)expected.add(range.campus);
 const candidates=progress.filter(p=>normalized(p.testName)===normalized(row.testName)&&matchesRecordingProgress(`${p.month}-01|test|${p.campus==='本校'?'hon':'minami'}|${p.campus==='本校'?'hon':'minami'}_${suffix}|1`,p));
 for(const candidate of candidates)expected.add(candidate.campus==='本校'?'hon':'minami');
 const checks=[...expected].sort().map(code=>{
  const options=candidates.filter(p=>p.campus===(code==='hon'?'本校':'南教室'));
  const selected=options.length===1?options[0]:null;
  return {campus:code==='hon'?'本校':'南教室',ready:!!selected&&(selected.noAbsences===true||selected.makeupComplete===true),noAbsences:selected?.noAbsences===true,makeupComplete:selected?.makeupComplete===true,verified:!!selected};
 });
 const own=candidates.filter(p=>p.campus===row.campus);
 const ready=own.length===1&&own[0].id===row.id&&checks.every(check=>check.ready);
 return {ready,checks,error:checks.some(check=>!check.verified)?'同じテストの進捗行が未確認または重複しているため非公開です。':''};
}
export function testRange(page) {
 if(page.archived||page.is_archived||page.in_trash||page.parent?.data_source_id!==recordingRangeSource)return null;
 const p=page.properties ?? {},title=plain(p['授業名']),match=/^(本|南)(\d)([A-Z]+)(数|算|英|国|理|社)$/.exec(normalized(title));
 const date=p['実施日']?.date?.start?.slice(0,10),test=p['テスト名']?.select?.name;
 if(!match||!/^20\d{2}-\d{2}-\d{2}$/.test(date ?? '')||!test?.startsWith('単元テスト'))return null;
 const campus=match[1]==='本'?'hon':'minami',level=Number(match[2])<=3?'j':'e';
 const subject={数:'math',算:'arith',英:'eng',国:'jp',理:'sci',社:'soc'}[match[4]];
 return {id:page.id,date,group:`${campus}_${level}${match[2]}_${match[3]}_${subject}`,campus,title,test};
}
export function rangeMatchesKey(range,key){const fields=String(key).split('|');return fields.length===5&&fields[0]===range.date&&fields[2]===range.campus&&fields[3]===range.group;}

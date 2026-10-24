export const operationAreas = Object.freeze({
 attendance:'遅刻・欠席連絡',classroom:'教室への連絡',contacts:'連絡先・生徒情報',
 interviews:'面談・アンケート',materials:'面談資料',schedule:'授業スケジュール',
 journals:'授業日誌',recordings:'録画',benkei:'ベンケイ',context:'塾全体の情報',
 enrollment:'入塾・見学後の入力',studyRoom:'自習室',feedback:'改善要望',other:'この画面',
});
const methods=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE']);
const symptoms=new Set(['http','network','timeout','invalid_response','application','client']);
const fields=['area','method','symptom','status','elapsedMs','online'];
export function checkedDiagnostic(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k))
  ||!Object.hasOwn(operationAreas,value.area)||!methods.has(value.method)||!symptoms.has(value.symptom)
  ||!Number.isInteger(value.status)||value.status<0||value.status>599
  ||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>3_600_000||typeof value.online!=='boolean'
  ||(value.symptom==='http'&&value.status<400)||(['network','timeout','client'].includes(value.symptom)&&value.status!==0))throw Error('invalid_diagnostic');
 return {area:value.area,method:value.method,symptom:value.symptom,status:value.status,elapsedMs:Math.round(value.elapsedMs),online:value.online};
}
export function diagnosticArea(pathname){
 if(/attendance/.test(pathname))return 'attendance';
 if(/classroom/.test(pathname))return 'classroom';
 if(/interview-material|material-worker/.test(pathname))return 'materials';
 if(/interview|survey|parent-contact|post-interview/.test(pathname))return 'interviews';
 if(/benkei/.test(pathname))return 'benkei';
 if(/school-context/.test(pathname))return 'context';
 if(/enrollment|visit-followup/.test(pathname))return 'enrollment';
 if(/study-room|self-study|reservation/.test(pathname))return 'studyRoom';
 if(/journal/.test(pathname))return 'journals';
 if(/recording/.test(pathname))return 'recordings';
 if(/schedule/.test(pathname))return 'schedule';
 if(/feedback/.test(pathname))return 'feedback';
 if(/contact|student|line-registration|line-alias/.test(pathname))return 'contacts';
 return 'other';
}
export function diagnosticFacts(input){
 const d=checkedDiagnostic(input),write=!['GET','HEAD'].includes(d.method);
 const action=write?'操作':'情報の取得';
 const state=!d.online?'ブラウザがオフラインの状態です。':d.symptom==='timeout'?'制限時間内に応答を受け取れませんでした。'
  :d.symptom==='network'?'接続先から応答を受け取れませんでした。':d.symptom==='invalid_response'?'応答を読み取れず、結果を確認できませんでした。'
  :d.symptom==='application'?'接続先から処理できなかったという結果が返りました。':d.symptom==='client'?'画面の処理でエラーが起きました。'
  :`接続先からエラーが返りました（HTTP ${d.status}）。`;
 return {observation:`${operationAreas[d.area]}の${action}で、${state}`,elapsed:`応答待ち：約${Math.max(1,Math.round(d.elapsedMs/1000))}秒`,
  outcome:write?'保存・送信の完了は、この情報だけでは判断できません。履歴や一覧で結果を確認してから再操作してください。':'最新情報を取得できていません。表示中の情報がある場合も、最新とは限りません。',
  certainty:'通信や画面の状態から分かる範囲の説明です。原因そのものを確定した説明ではありません。'};
}
export function checkedAnalysis(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_analysis');
 for(const k of ['assessment','nextStep']){
  if(typeof value[k]!=='string'||!value[k].trim()||value[k].length>600||/https?:\/\/|<[^>]*>/.test(value[k]))throw Error('invalid_analysis');
  // Reject retry/reload advice even when a provider ignores the prompt. We
  // cannot infer that a timed-out write did not complete from an absent row.
  if(/再(?:読み込[みむ]|読込|実行|試行|送信|送|起動|度.{0,12}(?:実行|操作|保存|送信))|リロード|やり直|もう一度|(?:ページ|画面).{0,6}更新|(?:同じ|同様の)操作.{0,6}試|\b(?:reload|refresh|retry|resubmit|resend)\b/i.test(value[k]))throw Error('invalid_analysis');
 }
 return {assessment:value.assessment.trim(),nextStep:value.nextStep.trim()};
}

import {checkedAnalysis,checkedDiagnostic,diagnosticFacts} from './operation-diagnostics.mjs';
export async function analyzeOperation(input,{key='',model='openai/gpt-oss-120b',fetcher=fetch}={}){
 const diagnostic=checkedDiagnostic(input);
 if(!key)throw Error('analysis_unavailable');
 const response=await fetcher('https://api.groq.com/openai/v1/chat/completions',{
  method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
  body:JSON.stringify({model,temperature:0,max_completion_tokens:900,reasoning_effort:'low',response_format:{type:'json_object'},messages:[
   {role:'system',content:'あなたは学習塾の業務画面で、操作できなかった状況を職員へ短い日本語で説明する。入力は限定された通信観測で、業務本文・原文・秘密値は含まない。観測と推定を区別する。原因を断定せず、不明な理由は不明と書く。特定の外部サービスの障害・制限・設定・DB負荷を根拠なく決めつけない。HTTP成功でも保存や送信の完了を推定しない。入力・対象・一覧を保つことを重視し、未確認の保存・送信を即再実行させない。再読み込みで入力を失う案内、権限拡大、認証回避、秘密値の入力、管理画面の変更は勧めない。自分が調査・復旧・保存をしたとは書かない。JSON {assessment:状況から考えられることと不明点を2文以内,nextStep:利用者が次に確認できることを1〜2文} のみ返す。URLとHTMLは書かない。'},
   {role:'user',content:JSON.stringify({observed:diagnostic,facts:diagnosticFacts(diagnostic)})},
  ]}),
 });
 if(!response.ok)throw Error('analysis_unavailable');
 const body=await response.json();
 return checkedAnalysis(JSON.parse(body.choices?.[0]?.message?.content??'{}'));
}

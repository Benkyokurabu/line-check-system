import {checkedAnalysis,checkedDiagnostic,diagnosticFacts} from './operation-diagnostics.mjs';
export async function analyzeOperation(input,{key='',model='openai/gpt-oss-120b',fetcher=fetch}={}){
 const diagnostic=checkedDiagnostic(input);
 if(!key)throw Error('analysis_unavailable');
 const response=await fetcher('https://api.groq.com/openai/v1/chat/completions',{
  method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
  body:JSON.stringify({model,temperature:0,max_completion_tokens:900,reasoning_effort:'low',response_format:{type:'json_object'},messages:[
   {role:'system',content:'あなたは学習塾の業務画面で、操作できなかった状況を職員へ短い日本語で説明する。入力は限定された通信観測で、業務本文・原文・秘密値は含まない。観測と推定を区別する。原因を断定せず、不明な理由は不明と書く。特定の外部サービスの障害・制限・設定・DB負荷を根拠なく決めつけない。HTTP成功でも保存や送信の完了を推定しない。権限拡大、認証回避、秘密値の入力、管理画面の変更は勧めない。自分が調査・復旧・保存をしたとは書かない。次の確認方法は、入力と選択を保ったまま既存の一覧・履歴・結果表示を確認し、判断できなければ担当者へ相談する範囲に限る。他の端末や画面で同じ操作を試すこと、ページ更新・再読み込み・リロード・ブラウザ再起動は提案しない。保存・送信・同じ操作の再実行や再試行は、未反映に見える場合も提案しない。入力に含まれる通信方法の英語や内部用語は、職員に分かる日本語に言い換える。JSON {assessment:状況から考えられることと不明点を2文以内,nextStep:既存の一覧や履歴の確認、担当者への相談を1〜2文} のみ返す。URLとHTMLは書かない。'},
   {role:'user',content:JSON.stringify({observed:diagnostic,facts:diagnosticFacts(diagnostic)})},
  ]}),
 });
 if(!response.ok)throw Error('analysis_unavailable');
 const body=await response.json();
 return checkedAnalysis(JSON.parse(body.choices?.[0]?.message?.content??'{}'));
}

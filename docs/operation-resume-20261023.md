# 2026-10-23 復旧・全体AI説明：別PCへの引き継ぎ

ユーザーは翌日に別PCで「続き」と言って再開する。今日は保存して終了する。以下は本番反映済みと未反映を区別した到達点。

## 最優先の訂正

ユーザーは「復旧を優先するために本番反映を保留したのは判断ミス」と明示した。障害中にこそ状況説明が必要。Supabaseの外部待ちを理由に全体AI説明の本番反映を止めない。復旧確認と並行し、未反映コードの最終レビュー・実モデル検証・画面確認を済ませ、本番反映まで進める。既存操作・入力・権限を壊さない。固定文をAI分析と偽らない。

## 取得先と再開操作

本体リポジトリは https://github.com/Benkyokurabu/line-check-system 。未反映コードは `checkpoint/operation-analysis-20261023`。mainには引き継ぎ文書だけを別途反映する。新PCでは利用可能な同リポジトリを探し、依頼外差分を保護してからfetchし、checkpointブランチを別worktreeまたはcloneで開く。古いmainをpushしない。既存の本番mainの追加変更があれば保持して統合する。

このPCの作業場所は `output/knowledge-context-20261022` だが、その絶対パスやignoredファイルが新PCに存在すると仮定しない。コード・試験・設計HTMLはcheckpointへ追跡保存。依存関係はnpm ciで再作成。秘密情報はコミットしていない。新PCの既存ローカル設定・認可済みサービスから必要な接続を取得し、秘密値をチャットへ貼らせない。本人認証が不可欠な場合だけ最小限依頼する。

## 本番へ反映済み

- 本体main `6f49ef6ec0d036d42befa71fd3a73fdaf7dd19ae`：遅刻欠席の取得ボタン直下へ状況表示。全JSON取得を含む15秒の読取上限・45秒の確認上限。結果不明時の再実行を煽らず、一覧を保持。関連lint・型を含むbuild・ブラウザ12件成功、Vercel配信一致確認。
- 独立した https://github.com/Benkyokurabu/student-calendar のmain `d7248f8e0c7b8e29cde24809011b1864edd462f7`：授業予定を先に表示、録画公開情報などに8秒上限、状態不明の録画リンク抑止、30秒再確認、月変更後の古い結果拒否。Pages配信一致・専用CI成功、PC/スマホで通常/障害/回復を検証。別のZoom公開URL workflowのfailureは未調査。本体DBの復旧とは区別する。

## 復旧の到達点

最後の実測は2026-10-23 22:43 JST。最小Data API読取、Auth health、勉たん `/api/attendance/status` が全て15秒でタイムアウト。別時点でstatement timeout、直接PG接続も認証15秒時間切れ。特定SQLの遅さだけが原因とは断定できない。16:29 JSTのLINE保存を一度確認したが全件受信済みとは言えない。DB変更・ロック解除・課金変更・再起動はしていない。

公式 https://status.supabase.com/incidents/01M5J8ZQ04EZXAYF10Q75MGC1T の履歴はbackplaneへの需要増と対策実施を説明するが、最新の題名はElevated Mgmt API Error Rates in Multiple Regions、対象はProject Creation。勉たんDB障害との直接因果は未確定。無料枠・猶予終了説も未確認。組織URLは https://supabase.com/dashboard/org/ditwdqmnsjmqedeybmnu 。Supabase連携は検索・追加提案済みだが未導入・未接続。利用可能になったらログ・プロジェクト状態を調べる。管理トークンや課金情報は取得できていない。

Chromeのnative captureはURLを安全に判定できずcomputer useを強制停止された。代替技術でブラウザ認証情報を抜くなどの迂回をしない。新PCでも利用可能な正規ツールを先に確認する。

## checkpointの全体AI説明

root layoutへOperationFeedbackを接続。fetch/JSON/画面エラーを観測し、操作ボタン直下へ事実と「AIによる分析」を分けて表示。業務本文・氏名・URL・ID・秘密値をモデルへ送らず、分類したarea/method/symptom/status/elapsedMs/onlineだけ送る。Groqの既存キー・gpt-oss-120bを使う。AIが使えない場合は取得不可と明示する。業務操作の自動再試行はしない。

分析APIは同一originと職員認可、毎分4回のプロセス内制限。DB障害時に分析自体が止まる問題へ、認可済み応答でのみ発行する15分の診断専用署名cookieを追加。業務APIはこれを認証として受け付けず、ログアウト時に消す。新規ログインやcookie期限切れではDB認証へ依存する点もレビューする。

関連Node24・認証試験・ブラウザ17件・lint・型を含む最終buildは成功。ただし実モデル検証、全体の最終レビュー、`docs/operation-support.html` の表示・操作確認、本番反映は未実施。全機能を完全にカバー済みとは言わない。新しい変更や懸念がなければ同じ試験を無制限に繰り返さず、必要な最終確認から本番反映へ進む。

主な試験は `tests/operation-analysis.test.mjs`、`tests/operation-diagnostics.test.mjs`、`tests/staff-auth-core.test.mjs`、`tests/browser/operation-feedback.spec.ts` とattendanceの2spec。前PCのignored Playwright設定はbase設定を継承しtestDirをtests/browser、channelをmsedge、webServer.cwdを作業ルートへ合わせたもの。新PCの利用可能なブラウザへ合わせる。ブラウザ試験はAI応答をmockしており実モデル検証を代替しない。

## 残る報告と別作業

館林紀美代さんへ原因・状況・今後の流れをTeamsで報告する明示許可あり。まだ未入力・未送信。復旧状態を正確に更新し、不明点を断定せず報告する。古いignored送信下書きが新PCにあると仮定しない。LINE送信や業務データ書込の追加許可は含まない。

作図CLI `01a167a1-55ba-7a01-ad66-40e5e5e9607c` へcomputer use再開を連絡済み。作図は保存・再読取完了の報告を受け、現在idle。追加作図は本人の次の依頼まで開始しない。新規エージェントを作らない。

診断・テストプロセスは終了。PCのLINE連携補助と知識取り込みwatchは電源断中に止まる。クラウドの本番サイト自体はこのPCの電源とは独立。復旧を未確認のまま完了扱いにしない。

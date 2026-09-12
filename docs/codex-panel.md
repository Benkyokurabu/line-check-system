# 勉たん内Codex

工藤の既存職員ログイン後、全ページ右下の「Codexに修正を依頼」から利用する。未ログイン・他職員には表示せず、APIも拒否する。ログインが必要な場合は既存の `/private-feedback` または職員自習室管理のログインを利用する。

- 「場所を選ぶ」で対象をクリックして指示を送る。URLのパス・ページタイトル・選択箇所のテキスト・要素種別を共有する。URLのクエリ、フォーム値、ページ全体のHTML、画像は自動送信しない。入力欄以外の表示済み個人情報が選択箇所に含まれる場合は共有される。
- 会話と依頼はSupabaseの非公開テーブルに保存する。ブラウザには会話IDだけを保存し、直近20会話を切替できる。一覧は会話内の直近50依頼。端末を変えた場合は会話IDの同期はしない。
- PCがオフラインでも依頼は受付・保存する。PCが復帰したら処理する。送信中の再試行は同一IDを使用する。
- Codexが承認を要求した操作は、その内容と許可・拒否ボタンを表示する。自動承認やセッション全体への包括許可は行わない。
- 「作業を停止」は未実行依頼を取消し、実行中のturnを中断する。すでに実施したファイル変更やpushは自動で戻さない。
- 回答済みはCodexのturnが完了した状態。デプロイ成功を意味しない。反映結果は回答本文を確認する。

## 接続構成

ブラウザ → Next.js `/api/codex`（職員認証＋同一オリジン検証）→ Supabase非公開キュー ← このPCのworker → Codex App Server標準入出力。

公開WebSocket、ローカルHTTP待受、ブラウザへのAPIキー配布は使用しない。ChatGPTの既存ログインを使い、APIキー認証へ自動で切替しない。ChatGPTの既存会話への接続ではなく、勉たん専用のCodex会話を作成・継続する。

Codex自体の設定・利用枠・認証期限の影響を受ける。App Serverの仕様変更時は、導入済みCLIの `app-server generate-json-schema` と疎通テストで確認する。参照: https://learn.chatgpt.com/docs/app-server

## 運用

- SQL: `supabase/codex_panel_20260912.sql`
- スキーマ検証（ロールバック）: `node scripts/apply-codex-panel-schema.mjs`
- 本番適用: 同コマンドに `--apply`。既存工藤アカウントを所有者に設定する。
- 認証疎通（回答生成なし）: `node scripts/codex-panel-worker.mjs --check`
- 実行用worktree: `.worktrees/codex-panel`。親リポジトリのmainから作成する。別リポジトリの `自習室予約システム/` は含まれない。そのリポジトリの修正はこの入口で自動対応できない。
- 起動: `scripts/start-codex-panel.ps1`
- 自動起動登録: `scripts/install-codex-panel-task.ps1`。Windowsタスク `BentanCodexPanel`、本人ログオン時・通常権限・非表示で起動。ログオン中のPCが必要。停止は同タスクの終了・無効化。
- ログ: `analysis_outputs/codex-panel/worker.log`。会話本文・コマンド出力・秘密値はworkerログに保存しない。Codex自身のローカル会話保存は通常設定に従う。
- `.env.local` のSupabase管理キーはworker内部でのみ使用。Codex子プロセスには環境変数をホワイトリストで引き渡す。作業用worktreeへ `.env.local` をコピーしない。
- workerは8秒ごとにheartbeatを更新。30秒失効で古い実行を失敗扱いにし、自動再実行しない。承認待ちも同様。DB更新はworker IDと有効leaseで保護する。
- Codexの修正は専用worktreeで検証・コミットし `git push origin HEAD:main`。force push禁止。通常作業フォルダの未コミット変更を混ぜない。先行更新・競合はCodexが確認する。

## 検証

`node --test tests/codex-panel.test.mjs`、対象eslint、`npx tsc --noEmit`、`npm run build`、`npx playwright test tests/browser/codex-panel.spec.ts`。
ブラウザテストは隔離されたAPI応答で実施し、本番にテストの修正依頼を送らない。

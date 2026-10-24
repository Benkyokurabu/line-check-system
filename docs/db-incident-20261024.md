# DB無応答の切り分け（2026-10-24）

ユーザー指定：Supabase側だけの問題と決めつけず確認し、こちらの問題なら早急に復旧する。こちらで原因が特定できた場合の復旧を依頼済み。原因未確認の一律再起動・全セッション切断・課金変更は行わない。

## 確認できたこと

- 16:10 JST、勉たんを介さないData APIの複数の小さな読み取りでHTTP 503 / `PGRST002`。存在しないテーブル名の検査・0行読取・職員コード1件の読取でも同様。勉たんの遅刻欠席statusはHTTP 500。
- 再確認ではAuth・Data API・アプリAPIが10秒時間切れ。常時同じ応答時間・状態ではない。
- 正規のDB接続プール `aws-1-ap-northeast-1` の5432/6543へ、公式Supabase CAを用いて証明書・ホスト名を確認して接続した。両方からSQLSTATE `XX000`、`(EAUTHQUERY) authentication query failed: connection to database not available` が返った。証明書検証の問題を解消しても、接続プールからDB本体への接続が成立しない。
- 直接DBホストにはDNS over HTTPSでAAAAが存在し、Aはない。このPCからIPv6接続は `ENETUNREACH`。これはこのPCの経路制約であり、DB停止の証拠として使わない。
- Supabase公式Metrics APIも15秒時間切れ。接続数・メモリ・ディスクの値はまだ取得できていない。
- 最近の本番DB追加（school-context、ベンケイ、個別枠）のSQLと管理スクリプトを検索・確認し、スキーマ削除・`pgrst.db_schemas`・authenticatorロールの公開設定変更は見つからなかった。これだけでDB負荷・接続枯渇の可能性までは除外しない。
- 既存Vercel CLIの認証はAPIで403/forbidden。管理ログの読み取りには使用できなかった。GitHubの配信状態は引き続き読める。

## 原因の確定に残る確認

`PGRST002` はDBへの接続やスキーマキャッシュ構築の失敗を示す。接続プールの `EAUTHQUERY` と合わせ、画面だけの不具合ではない。一方で、DB停止・過負荷・接続上限・構成問題のどれかは未確定。公式の管理API障害と同じ原因とも断定しない。

Supabaseプラグインは検索で未追加・未接続を確認。このセッションのcomputer-useに操作可能なブラウザはない。CLIの保存済みSupabase管理トークンも見つかっていない。本人によるSupabase追加・接続を依頼し、その間に上記の直接接続・コード調査を行った。

接続できたら、対象プロジェクトの稼働状態、DB/PostgRESTログ、CPU・メモリ・ディスク・接続数、実行中SQL/ロック、公開スキーマと実在スキーマの一致を確認する。こちらの処理が詰まらせていることを特定した場合は、変更前の状態と対象を保存し、対象を限定して復旧し、職員ログイン・業務記録の読取と安全な保存確認へ進む。未処理の業務や公開ルールを一括リセットしない。

## 状態

この調査では業務データ・DB設定・ジョブ設定・課金・Zoom共有設定を変更していない。DB復旧は未達。個別の原本値やクエリ全文を含み得る診断証跡はignored `.private/db-recovery-20261024/` に保存し、Gitへ追加しない。

公式資料：[エラーコード](https://supabase.com/docs/guides/api/rest/postgrest-error-codes)、[PGRST002と公開スキーマ](https://supabase.com/kb/troubleshooting/postgrest-error-pgrst002-could-not-query-the-database-for-the-schema-cache)、[Metrics API](https://supabase.com/docs/guides/observability/metrics/vendor-agnostic)。

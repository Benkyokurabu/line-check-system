# Notion・LINEの原文検索と根拠付き確認候補

2026-10-22 作成。本番コードへ接続するbackend。公開対象は職員個人認証のKUDOのみで、職員全員への公開はしていない。ベンケイの共有確認機能とは別のデータ・権限で動く。

## 保存するもの

`school_context_sources` は発見した取得対象と継続状態、`school_context_records` は原文・出典ID・内容ハッシュによる版・取得日時・原文URL・取得範囲・関連付け根拠を保存する。同じ版の再取得で原文を重複作成しない。更新された原文も過去版を消さない。階層取得中は進捗を永続保存し、前回の完全版を表示上保持して更新確認中と扱う。

`school_context_coverage` は取得範囲、失敗、権限不足、途中cursorを履歴として残す。取得失敗を「0件」「記録なし」に変換しない。`school_context_state` はNotion検索・LINEページングのcursorと同期排他leaseを保存する。同期が異常終了した場合はleaseが10分で失効する。

`school_context_proposals` は根拠付き確認候補、`school_context_decisions` は採用・保留・不要の職員ID、理由、日時の履歴を保存する。「採用」は判断の記録であり、LINE送信や業務完了を意味しない。同じ原本・同じルールの候補は再生成しないため、保留・不要・採用済みの候補が同期のたびに復活しない。根拠の版が変わった候補には `evidence_stale` を返す。

全テーブルはRLS有効でanon/authenticatedへの権限を剥奪し、RPCはservice_roleのみが呼べる。閲覧・判断RPCの内部でもstaff_authorizeを再実行して、稼働中のKUDO個人職員だけを許可する。

## 取得できる範囲と限界

Notionは接続に共有されたページを検索APIで発見し、全cursorを継続して初回取得する。ページのプロパティと本文ブロックを取得し、子ブロック・ページングも継続する。更新日時の変化を検出して再取得し、変更がなくても24時間ごとに再確認する。取得中に原本が変われば新しい版でやり直す。検索一巡から消えた旧原本も直ちに不存在と扱わず、再確認対象にする。接続への未共有・検索インデックスの遅延・API側の上限は塾全体を把握できたことにはならない。

コメント、画像・音声・添付の内容、閲覧権限がないページは対象外。Notionプロパティのrelation等がAPI応答で省略されている場合もcoverageに残し、完全取得扱いにしない。relationは原文にある関連ページIDとして保存するが、そのIDだけで生徒本人を確定しない。既存 `student_registry.notion_page_id` と正確に一致した場合に限り、対応表とrelationプロパティ名を根拠として生徒番号を関連付け、LINEと同じ生徒番号で横断検索できる。氏名の類似だけでは結び付けない。

LINEは既存 `line_messages` の inbound/outbound の両方を読み取り、原文を別テーブルへ保存する。`student_line_accounts.verification_status='confirmed'` の対応だけを、生徒検索に使える関連として保存する。同じLINEに複数生徒が確認済みで関連している場合は全件を根拠と共に保持する。元のLINEテーブル、送信経路、連絡先登録は変更しない。

管理画面の直接返信はMessaging APIの受信webhookだけでは網羅したと扱わない。履歴ファイルからの取込は別CLIの `records` と `coverage` を受け取れるが、ファイル範囲外・未取込経路の送信は不明のまま残す。チャット一覧の最新文を個別メッセージの送受信履歴に変換しない。画像・音声の意味理解も未対応。したがって未返信・未対応を自動断定しない。

公式参照: [Notion Search](https://developers.notion.com/reference/post-search)、[Notion Retrieve block children](https://developers.notion.com/reference/get-blocks-children)、[LINE 受信webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)。Notionの権限範囲とLINEのユーザー送信イベントは公式仕様に基づき、管理画面経由の網羅性は未確認として保守的に扱う。

## 候補の作り方

全文を一回で外部LLMへ送る構成ではない。検索は関連する原文を取得する。今回の候補生成は外部LLMを使わないルール方式で、直近30日以内の原文に「要確認」「相談」「面談」等の表現がある場合に原文確認の候補を作る。日時不明・将来・古い原文、送信済み方向、未完全取得のNotion原文、アーカイブ原本からは新しい候補を作らない。過去の原文は検索できる。

候補文は「原文と最新のやりとりで必要性を確認してください」という内容で、既に終わった対応を未完了と判断しない。生徒名の推測、返信文の自動送信、原本の自動変更は行わない。

## API

`GET /api/staff/school-context?view=summary|list|search|proposals|coverage&q=&studentId=&limit=20`

常に `{records,proposals,coverage,summary}` を返す。summaryは件数と先頭5件。limitは1〜100、qは200字まで。studentIdは確認済み生徒対応のIDにのみ一致させる。原文は `content`、出典は `source_key/version/source_ref`、取得状態は `coverage/source_status`。

`POST /api/staff/school-context` に `{action:'sync'}` または `{action:'decision',proposalId,decision:'accepted'|'held'|'dismissed',reason?}`。POSTは職員認証と同一originを要求する。同期は1バッチだけ実行し、取得中なら次回に継続する。別同期が稼働中なら `{busy:true,canContinue:true}`。

`POST /api/cron/school-context-sync` は既存のcron認証方式を使い、1バッチを実行する。認証なしは401。cron結果には件数・状態・安全なエラーコードを返し、原文や秘密値は返さない。

## 本番適用と運用

実施担当はroot。既存Notion、LINEの送信設定、スタッフ登録は変更しない。

1. `node --test tests/school-context*.test.mjs`
2. `node scripts/school-context-admin.mjs --schema --apply`
3. `node scripts/school-context-admin.mjs --sync` で読取だけのdry-runを確認。
4. `node scripts/school-context-admin.mjs --sync --apply --batches 10` などで原文を取り込む。初回全文取得は全cursorと未処理対象が終わるまで複数バッチ必要。進行中は未完了のまま表示する。
5. `node scripts/school-context-admin.mjs --import-line analysis_outputs/line-context/context.json` で検証し、`--apply` を追加して取込。`{records:[],coverage:[...]}` のようなcoverageだけのファイルも保存できる。
6. コードの本番反映を確認してから `node scripts/school-context-admin.mjs --schedule --apply`。新規 `bentan-school-context-sync` だけを2分ごとに登録する。既存vaultのURLと認証が一致することを確認し、既存cronや秘密値を変更しない。

スクリプトの既定動作は読取確認のみ。秘密値と原文は標準出力に出さない。DB接続失敗は概要だけを返す。

`src/lib/school-context-cron.mjs` の `scheduleSchoolContextJob` は、別の新規 `bentan-benkei-sync` / `/api/cron/benkei-sync` の登録にも利用できる。ベンケイの同期をcontext同期へ無条件追加せず、それぞれ独立したjobとして登録する。

## 検証

Nodeテストと隔離PGliteを使用。原文版の冪等保存・訂正版保持・検索・確認済み生徒対応・保留再浮上防止・判断履歴・anon/authenticated拒否・KUDO限定・Notion階層/cursor継続・LINE同時刻cursor・同期lease・403失敗coverage・coverageだけの取込を検証する。既存運用DBにはテストデータを入れない。

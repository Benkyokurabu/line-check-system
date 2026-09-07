# 授業スケジュール取込

勉たんの独立した業務画面 `/schedule-import`。年月を選び「スケジュールを確認」を押すと、サーバーがOneDriveのExcelを直接読み取って本番との差分を表示する。
統合設計の「正本は一つ」「差分確認」「機能ごとの導入」に従う。

## 通常の操作

1. OneDriveの `デスクトップ/【完成版】授業日誌システム` に `YYYY年M月スケジュール.xlsm` を保存する。
2. 勉たんの「授業スケジュール取込」を開く。保存済みの月を自動取得する。
3. 今月・翌月は各月約10分ごとに自動反映される。「自動反映の状況」で「反映完了」または「反映済み・変更なし」を確認する。急ぐ場合は対象月を選び「今すぐ取り込む」。差分だけ見る場合は「スケジュールを確認」。

JSONの作成・ファイル選択・PCでのコマンド実行は通常操作に不要。保存した原本を運用の正本とするため、編集中の下書きはこのフォルダ外に置く。保存・OneDrive同期から2分間は反映を待つ。

「確認が必要・反映保留」は完了ではない。休講、日付・校舎変更、複数授業の対応が曖昧な変更、過去授業の変更、多数の変更、片方の校舎を読み取れない場合は月全体を保留する。原本の間違いなら原本を修正して保存する。意図した休講・移動なら管理担当者へ差分の確認を依頼する。自動削除や別授業への出欠記録の付け替えは行わない。

## ブラウザからの実装

- `GET /api/schedule/preview` は保存済みの月、`?month=YYYY-MM` は差分を返す。既存の教室授業照会と同じ読み取り用途。任意のフォルダ・ファイルID・URLを入力するAPIは公開しない。
- `schedule-excel.mjs` は従来のPythonの抽出ルールをNode.jsへ移植したもの。セル結合、学年別時間帯、対面・特別授業、講師色の凡例に対応。SheetJSが落とすindexed色は元の書式XMLから復元する。実９月原本337件で従来出力と全件一致を確認。
- Graph APIで設定済みフォルダの原本のみ取得。重複原本・空データ・不正な日付/時間/教室を拒否。原本のeTagを読取前後に照合し、本番授業も比較前後で再取得する。
- 接続は既存rcloneの認証を管理用スクリプトで引き継ぐ。`schedule_cloud_connection` はRLS有効、anon/authenticated/PUBLICの権限を剥奪。接続情報はサーバーの既存秘密鍵から導出した鍵でAES-GCM暗号化して保管し、アクセストークン期限前に更新して保存する。
- ブラウザには接続情報・GraphのID・署名付きURL・生徒名・連絡本文を返さない。エラーは利用者向けの説明に変換する。同時要求をまとめ、結果はサーバー内で最大15秒再利用する。HTTP応答はno-store。
- Microsoftの認証が取り消された場合は管理担当者が再接続する。サーバーのSUPABASE_SECRET_KEYを変更した際も暗号化接続の再設定が必要。元のrclone設定は変更しない。

接続の初期設定/再設定（管理担当者用）:

```powershell
node scripts/configure-schedule-cloud.mjs
```

関連仕様: [Graphのファイル取得](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)、[Microsoft認証更新](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)、[rclone OneDrive接続](https://github.com/rclone/rclone/blob/master/backend/onedrive/onedrive.go)。

## コマンドによる代替確認

従来の専用ワーカーは保守・障害調査用として残す。ブラウザ画面ではその出力ファイルを要求しない。

- OneDrive `デスクトップ/【完成版】授業日誌システム` 直下の `YYYY年M月スケジュール.xlsm` を指定月で一意に選択。
- rcloneでクラウドから一時フォルダへ取得。同じ月の原本が複数ある場合・存在しない場合は停止。
- 既存の `export_schedule_json.py` とその読み取りライブラリを使用。旧 `extract_and_push.py` は起動しない。
- Excel、授業日誌、既存JSON、Git、DBは変更しない。Pythonのキャッシュとログも既存フォルダに書かない。
- 原本を再取得してSHA-256を照合。本番授業も比較の前後で読み直し、変更中なら停止。
- 本番授業はページ送りで全件取得。確定出欠・候補・候補明細は授業への関連件数だけ読む。氏名・連絡本文は取得しない。
- 時間・教室変更は同日・同校舎・同クラス・同科目で一意の場合のみ既存IDとの対応を提示。曖昧な対応、原本にない授業、関連する出欠記録は確認対象。
- 確認ファイルは非公開の `analysis_outputs/schedule-preview/` へ日時別に保存。
- 同時に単独でブラウザ表示できるHTMLも出力する。初回の確認にアプリへのファイル選択は不要。HTMLには実行スクリプト・外部通信を含めない。
- 確認ファイルは信頼済み承認データではなく、将来の反映処理へそのまま渡してはならない。

## 実行

```powershell
npm run schedule:preview -- --month 2026-09
```

必要な接続は既存rclone `onedrive` と `.env.local` のSupabase接続。Pythonとopenpyxl、既存読み取りスクリプトが必要。
環境により `--exporter-dir`、`--remote`、`--rclone`、`--python`、`--output-dir` を指定可能。
一時ファイルはOSのTEMPに残るため、調査完了後の保管期限管理は今後整える。

## 本番の自動反映

- `POST /api/cron/schedule-sync` は専用HMACトークン必須。Supabaseのpg_cron/pg_netから5分ごとに起動し、今月と翌月を交互に処理する。PCやブラウザを開いておく必要はない。
- `POST /api/schedule/sync?month=YYYY-MM` は同一Originからの起動要求のみ。サーバーが原本を再取得する。任意の授業データ、原本URL、承認フラグは受け付けない。公開画面から危険な差分を承認する機能は設けない。
- DBの共有リースは3分、再起動間隔は最低1分。クラッシュした処理は期限後にエラーとして記録して再試行する。
- 原本eTagを取得前・取得後・DB照合後に検査し、反映時はDBの月全件のID・updated_atを確認してテーブルロック下で一括保存する。途中の例外は全変更をロールバックする。
- 追加と一意な時間・教室・担当等の変更を反映する。既存UUIDは保持し、欠席・遅刻の紐付けを保つ。出欠そのものやNotionの確定記録は書き換えない。
- `schedule_sync_runs` に成功・変更なし・保留・失敗・待機の履歴を保存。変更・保留時は非公開の変更前スナップショットと差分、原本SHA-256を保存する。自動巻き戻しは行わず、必要時に管理担当者が当該スナップショットと現状の出欠を照合して復旧する。
- `GET /api/schedule/status` は秘密値・生徒情報・内部スナップショットを除いた直近の状況を返す。画面は30秒ごとに更新し、cron起動を20分確認できなければ警告する。メールやLINEへの通知は行わない。
- 翌月の原本がなければ保存待ち、今月の原本がなければエラーとして表示。過去月は照会のみ。

管理担当者の配備・停止・再開:

```powershell
node scripts/configure-schedule-sync.mjs
# コードのデプロイと動作確認後に定期実行を有効化
node scripts/configure-schedule-sync.mjs --enable
node scripts/configure-schedule-sync.mjs --inspect
# 障害時は授業を残して同期のみ停止
node scripts/configure-schedule-sync.mjs --disable
```

Microsoft認証取消時はクラウド接続を再設定して再開する。サーバー秘密鍵を変更した場合はクラウド接続の再設定と `--enable` によるcronトークン更新の両方が必要。履歴・接続・制御テーブルとRPCはブラウザ用DBロールからアクセス不可。

## 検証

`npm run test:schedule`（比較・Excel・クラウド取得・暗号化・DB権限・排他制御・出欠FK保持・古い差分の拒否・トランザクションのロールバック）、対象ESLint、TypeScript、ビルド、ブラウザ試験。実原本ではサーバー処理から登録済み９月分との全件一致を確認する。

# 授業スケジュール取込

勉たんの独立した業務画面 `/schedule-import`。年月を選び「スケジュールを確認」を押すと、サーバーがOneDriveのExcelを直接読み取って本番との差分を表示する。
統合設計の「正本は一つ」「差分確認」「機能ごとの導入」に従う。

## 通常の操作

1. OneDriveの `デスクトップ/【完成版】授業日誌システム` に `YYYY年M月スケジュール.xlsm` を保存する。
2. 勉たんの「授業スケジュール取込」を開く。保存済みの月を自動取得する。
3. 対象月を選び「スケジュールを確認」を押す。追加・変更・原本にない授業・関連する出欠記録数を確認する。

JSONの作成・ファイル選択・PCでのコマンド実行は通常操作に不要。ボタンは読み取りと照合のみで、授業・出欠の登録更新はしない。

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

## 次の段階（未実装）

職員権限付きの反映API、反映直前の原本・DB再照合、変更トランザクション、出欠関連を保った休講処理、監査履歴、定期実行・失敗監視。
データを読み取れることと、正式に確定済みであることは別。定期反映の開始前に原本確定の扱いを組み込む。

## 検証

`npm run test:schedule`（比較・Excel・クラウド取得・暗号化・接続テーブルの権限）、対象ESLint、TypeScript、ビルド、ブラウザ試験。実原本ではサーバー処理から登録済み９月分との全件一致を確認する。

# LINEの送信・返信を勉たんが把握する範囲

確認日: 2026-10-22

勉たんから送る返信は既存の送信APIが `line_messages` に保存している。公式管理画面・管理アプリで直接送った返信は別の取得経路が必要。今回追加したのは、取得済みの履歴CSV/JSON/JSONLを根拠付きの共通形式へ変換し、重複させずにローカル保存するCLIである。既存のLINE送信・受信・本人確認・生徒への紐付けは変更しない。

| 経路 | 取得根拠 | 今回の扱い |
| --- | --- | --- |
| 勉たんからの送信 | `line_messages.direction=outbound`、送信者・受付時刻・request ID | 共通コンテキスト同期が既存DBを参照 |
| 利用者からの受信 | 既存Webhook保存 | 共通コンテキスト同期が既存DBを参照 |
| 管理画面・管理アプリの直接返信 | 管理画面から取得したメッセージ履歴ファイルなど | CLIで送受信・本文・出典・日時・照合状態を保存 |
| トーク一覧CSV | 最新文のプレビュー・最終受信時刻 | 取得範囲だけ保存。メッセージ本文履歴として登録しない |
| 画面テキストのキャプチャ | 表示されていた文字列 | 発言者や方向を保証できないため本文履歴として自動登録しない |

LINE公式資料ではWebhookはユーザーからのメッセージ等を通知する仕組みとして説明され、任意の管理画面返信全文を取得するAPIは示されていない。したがって、この経路だけを根拠に管理画面からの返信を網羅したとは扱わない。[Messaging APIリファレンス](https://developers.line.biz/en/reference/messaging-api/)、[受信Webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)。

公式管理画面にはチャットProオプション向けの履歴ダウンロードがあり、チャット設定からは直近5年・最大10万ルーム・CSV作成は週1回までと案内されている。利用可否・実ファイルの列構成・取得期間はアカウントと取得したファイルを確認する必要がある。契約や購入はこの実装では行わない。[公式チャット設定マニュアル](https://www.lycbiz.com/jp/manual/OfficialAccountManager/chat-various-settings/)、[公式チャットマニュアル](https://www.lycbiz.com/jp/manual/OfficialAccountManager/chats/)。

## 実行方法

```powershell
# 確認のみ。本文や個人名は標準出力へ表示しない。
node scripts/line-context-sync.mjs once --account <アカウント識別名> --input <履歴.csv>

# ローカル保存。LINE送信やline_messages更新は行わない。
node scripts/line-context-sync.mjs import --account <アカウント識別名> --input <履歴.csv> --apply

# 取得済みファイルの更新を30秒ごとに再読取する。ブラウザからの取得は行わない。
node scripts/line-context-sync.mjs watch --account <アカウント識別名> --input <履歴.csv> --apply --interval 30000

# 共通コンテキスト側の取込（担当する管理CLI）
node scripts/school-context-admin.mjs --import-line analysis_outputs/line-context/context.json --apply
```

入力は複数の `--input` を指定可能。`--format csv|json|jsonl`、`--output <path>` で変更可能。標準保存先はGit対象外の `analysis_outputs/line-context/context.json`。履歴本文・LINE ID・出典のローカル絶対パスを含み得るため、公開リポジトリへ追加しない。

CSVは `message_id,line_user_id,direction,timestamp,sent_by,text` または対応する日本語列を読む。UTF-8を使用する。方向は明示された送受信の値だけ採用し、不明な方向は `unknown`。日時は年月日と時刻がそろった値だけ扱い、タイムゾーン省略時は日本時間とする。相対時刻、日付だけ、未確定の宛先・送信者は補完しない。名前だけで生徒を自動確定しない。

キャプチャJSONLは保存済みの `network_response` のうちメッセージ/eventsエンドポイントのJSONを読む。チャット一覧の `latestEvent` を全文履歴へ変換しない。実ファイルで方向が明示されない形式は不明のまま保存する。

## 共通コンテキストとの契約

出力は `{version:1,records:[],coverage:[],warnings:[]}`。各recordは `sourceKey, sourceType, nativeId, account, direction, actor, occurredAt, content, lineUserId, sourceRef, identityStatus, association, coverage, verification` を保持する。本文は原文の空白・改行を保持する。`association=[]` は生徒紐付け未確定を意味する。

安定したネイティブメッセージIDがあればアカウントとIDを使って重複防止する。IDがなければ宛先・時刻・方向・送信者・本文の指紋を使用し、宛先や時刻も不明ならファイル内容と行位置を根拠IDにする。不明情報を補って既知メッセージへ統合しない。再実行・ファイルの読取失敗で既存レコードを削除しない。

`coverage.complete=false`、`noReplyAssessment=unknown` を保存する。管理画面返信を網羅していない間は「返信が保存されていない」から「未返信」へ断定しない。受信後にoutboundがあっても、その返信が該当する依頼を解決したかは別の確認である。

## 確認結果

11件のNodeテストと関連eslintが成功。実在するトーク一覧CSV2件をdry-run後にローカル登録し、2,205行・2,229行の取得範囲を保存した。本文履歴としての登録は0件。2件を合算して固有の生徒数や履歴件数とは扱わない。

既存キャプチャJSONL2件はファイルの存在を確認したが、読取時にOneDrive上の `UNKNOWN read` が発生した。本文を読めたとは報告しない。管理画面の直接返信を継続的に網羅する状態には至っていない。送信者/方向が確認できる実際の履歴ファイルの取得と、契約済み管理画面での利用可否確認が残る。

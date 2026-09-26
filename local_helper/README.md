# 面談資料アプリ（各PC用）

勉たんの「面談資料を作る」画面からNAS上の資料を読むローカル補助アプリです。127.0.0.1のみに待ち受け、勉たん本番画面からの資料作成要求だけを受けます。生成したPDFはPCの一時フォルダに置き、15分後に削除します。

## 2台のPCで使う

各PCに同じ版の補助アプリを設置します。資料作成時は、そのPCからNASの原本を読みます。「OneDriveに保存」を押した一式PDFだけを、そのPCの `%OneDrive%\面談準備\保存済み資料` に保存します。PDF名には作成日時・学籍番号・重複防止IDを付け、別PCから保存しても上書きしません。`rclone` の `onedrive:` 接続が設定済みのPCではクラウドへ直接アップロードし、成功したときだけ画面にクラウド保存済みと表示します。それ以外のPCではOneDriveデスクトップアプリによる同期を使い、切り替える前に同期完了を確認してください。

「一式PDFを保存」は従来どおりブラウザのダウンロード先へ保存します。資料の原本、実行ファイル、一時PDFはOneDriveの保存済み資料フォルダへコピーしません。

中3共通資料のうち、一太郎の偏差値段階表（3ページの北辰偏差値基準資料）は面談用PDFに含めません。

## 配布・設置

配布フォルダに `BentanInterviewMaterials.exe`、`install.ps1`、`export-guide.ps1`、`sources.txt`、`guide-path.txt` を置き、各PCで `install.ps1` を一度実行します。`sources.txt` は `ばしょ.txt` の7行、`guide-path.txt` は指導簿原本のUNCパス1行です。現在のユーザーのローカルフォルダに設置し、Windowsログイン時の自動起動を登録します。ExcelとNASへのアクセスが必要です。

## 更新

資料の場所を変えた場合は、配布フォルダの設定ファイルを更新して再設置します。

## ビルド

`pip install -r requirements.txt pyinstaller` の後、`python -m PyInstaller --onefile --noconsole --name BentanInterviewMaterials helper.py` を実行します。配布時は `dist/BentanInterviewMaterials.exe` を設定ファイル・`install.ps1` と同じフォルダへ置きます。

# 面談資料アプリ（各PC用）

勉たんの「面談資料を作る」画面からNAS上の資料を読むローカル補助アプリです。127.0.0.1のみに待ち受け、勉たん本番画面からの資料作成要求だけを受けます。生成したPDFはPCの一時フォルダに置き、15分後に削除します。

## 配布・設置

配布フォルダに `BentanInterviewMaterials.exe`、`install.ps1`、`export-guide.ps1`、`sources.txt`、`guide-path.txt` を置き、各PCで `install.ps1` を一度実行します。`sources.txt` は `ばしょ.txt` の7行、`guide-path.txt` は指導簿原本のUNCパス1行です。現在のユーザーのローカルフォルダに設置し、Windowsログイン時の自動起動を登録します。ExcelとNASへのアクセスが必要です。

## 更新

資料の場所を変えた場合は、配布フォルダの設定ファイルを更新して再設置します。

## ビルド

`pip install -r requirements.txt pyinstaller` の後、`python -m PyInstaller --onefile --noconsole --name BentanInterviewMaterials helper.py` を実行します。配布時は `dist/BentanInterviewMaterials.exe` を設定ファイル・`install.ps1` と同じフォルダへ置きます。

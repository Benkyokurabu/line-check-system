# 北辰基礎資料の全学校目次

面談資料画面の上部「北辰基礎資料（全学校）」から、生徒を選ぶ前でも「北辰基礎資料を見る」で開ける。既存の資料プレビュー内の「北辰基礎資料の目次」「学校目次」も維持。学校名で検索し、公立・私立で絞り込む。

「北辰用フォルダを保存」で、独立した「北辰基礎資料」フォルダに全学校のPDFと「北辰基礎資料.html」を1セットだけ保存する。必要なときにこのHTMLを開き、検索・PDF表示・前後の資料への移動・印刷ができる。全学校で約750MB。既存のPDFはサイズとSHA-256を照合して再利用し、1件ずつ処理するため全750MBをメモリに抱えない。全件が保存・検証できるまで既存の専用HTMLを上書きしない。

「面談用フォルダを保存」では本人の選択資料・面談記録・生徒情報と「面談資料.html」のみを保存する。全学校の追加ダウンロードは行わず、学校ライブラリの接続障害でも生徒用保存は利用できる。生徒用HTMLと北辰用HTMLは依存せず、ネット接続なしで別々に使える。別PCへ移す際は必要なフォルダを丸ごとコピーする。従来保存済みフォルダのファイルは自動削除しない。印刷用の一式PDFも元の選択資料だけを維持。

2026-10-03の学校一覧は353件（2027年度341件、旧年度のみ12件）。NASの作業用スキャン・過去資料フォルダは除外。学校・学科ごとに最新年度を優先する。年度による県立・市立の表記、確認できた学科名の変更も照合する。県立と市立、各学科は混同しない。

## 非公開資料の更新

学校資料は既存の非公開バケット `interview-material-bundles` の `hokushin-library/` に保管する。職員認証を要求する `/api/staff/interview-material-school-library` で、検証した学校別パスだけの閲覧URLを発行する。生徒の依頼や作成PCアプリの更新は不要。生徒の個人成績票や私立推薦基準は学校ライブラリへ含めない。

1. `local_helper/school_library.py --source <北辰偏差値基礎資料の年度フォルダ> --output <ローカル出力先>` で全校PDFと `catalog.json` を作成する。NAS原本は変更しない。
2. `node scripts/sync-hokushin-school-library.mjs --env <ローカル環境設定> --catalog <catalog.json>` で件数・PDFハッシュ・非公開保管先を確認する。
3. 同コマンドへ `--apply` を加えると、各PDFを登録してから一覧を更新する。PDFを内容ハッシュ別のパスに保管するため、既存の表示・旧フォルダ保存を妨げない。
4. `node --test tests/hokushin-school-library.test.mjs`、Pythonの `test_school_library`、ブラウザの `interview-materials-save.spec.ts` と `interview-material-offline.spec.ts` を検証する。

ローカルに全校PDFが用意できている場合は、`node scripts/create-offline-school-library.mjs --catalog <catalog.json> --output <北辰基礎資料フォルダ>` で専用フォルダを作成できる。今回の作成先はプロジェクトrootの `面談準備/北辰基礎資料/`。専用保存・再利用・破損時再取得・失敗時の既存HTML保護は `tests/browser/hokushin-school-library.spec.ts` で検証する。

ジョブの保存期限による既存の削除処理は `jobs/<job-id>/` だけを対象とするため、共通学校資料を削除しない。生徒用保存では選択PDFの取得失敗時、以前の生徒フォルダへの書き込みを開始しない。

保存構成と操作確認： [2つのフォルダ・HTMLの構成](hokushin-school-library-layout.html)。専用HTMLは `面談準備/北辰基礎資料/北辰基礎資料.html`（root基準）。

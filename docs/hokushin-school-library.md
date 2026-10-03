# 北辰基礎資料の全学校目次

面談資料の「画面で見る」上部にある「北辰基礎資料の目次」、または資料切り替えの「学校目次」から開く。学校名で検索し、公立・私立で絞り込んで学校・学科のPDFへ移動する。目次へ戻ると検索条件を保持する。

「面談用フォルダを保存」では、選んだ面談資料に加えて北辰基礎資料の全学校をPDFとして保存する。保存済みの「面談資料.html」でもネット接続なしで同じ目次を利用できる。旧HTMLへ自動追加はしないため、保存し直す。全学校で約750MBのため保存には時間がかかる。印刷用の一式PDFは、資料作成時に選んだ資料のみ。

2026-10-03の学校一覧は353件（2027年度341件、旧年度のみ12件）。NASの作業用スキャン・過去資料フォルダは除外。学校・学科ごとに最新年度を優先する。年度による県立・市立の表記、確認できた学科名の変更も照合する。県立と市立、各学科は混同しない。

## 非公開資料の更新

学校資料は既存の非公開バケット `interview-material-bundles` の `hokushin-library/` に保管する。職員認証を要求する `/api/staff/interview-material-school-library` で、検証した学校別パスだけの閲覧URLを発行する。生徒の依頼や作成PCアプリの更新は不要。生徒の個人成績票や私立推薦基準は学校ライブラリへ含めない。

1. `local_helper/school_library.py --source <北辰偏差値基礎資料の年度フォルダ> --output <ローカル出力先>` で全校PDFと `catalog.json` を作成する。NAS原本は変更しない。
2. `node scripts/sync-hokushin-school-library.mjs --env <ローカル環境設定> --catalog <catalog.json>` で件数・PDFハッシュ・非公開保管先を確認する。
3. 同コマンドへ `--apply` を加えると、各PDFを登録してから一覧を更新する。PDFを内容ハッシュ別のパスに保管するため、既存の表示・旧フォルダ保存を妨げない。
4. `node --test tests/hokushin-school-library.test.mjs`、Pythonの `test_school_library`、ブラウザの `interview-materials-save.spec.ts` と `interview-material-offline.spec.ts` を検証する。

ジョブの保存期限による既存の削除処理は `jobs/<job-id>/` だけを対象とするため、共通学校資料を削除しない。一覧の取得・PDFダウンロードに失敗した場合は保存済み生徒フォルダへの書き込みを始めない。

画面・操作確認： [全学校目次のHTML](hokushin-school-library-design.html)。ローカル設計資料のPDFは `analysis_outputs/hokushin-library/pdf/` を参照する。

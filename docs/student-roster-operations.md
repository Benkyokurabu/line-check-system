# student_roster 運用メモ

## これは何か

`student_roster` は、アプリ側DBにある生徒名簿テーブルです。

主な用途:

- 出欠連絡画面で生徒名を選ぶ
- LINE連絡先を生徒に紐づける
- 授業・クラス所属から出欠登録先を絞る
- 生徒カルテで Notion / LINE / クラス一覧Excel の情報をつなぐ

## どこで作られるか

テーブル定義は `supabase/schema.sql` にあります。

主な列:

- `student_number`: 生徒番号。主キー
- `grade`: 学年
- `student_name`: 生徒名
- `homeroom_teacher`: 担任
- `campus`: 校舎
- `school_name`: 学校名
- `gender`: 性別
- `source_file`: 元になったExcelファイル
- `updated_at`: 更新日時

関連テーブル:

- `student_class_enrollments`: 生徒ごとの受講クラス
- `student_line_accounts`: 生徒に紐づくLINEアカウント
- `student_line_links`: 旧形式の主LINEリンク

`student_line_accounts` と `student_line_links` は `student_roster.student_number` を参照しているため、LINE紐づけを入れる前に対象生徒が `student_roster` に存在している必要があります。

## 元データ

基本の元データは、プロジェクト直下のクラス一覧Excelです。

対象ファイル:

- ファイル名に `クラス一覧表` を含む
- 拡張子が `.xlsx`

例:

- `・小４　クラス一覧表(2026).xlsx`
- `・中３　クラス一覧表(2026)／担任済.xlsx`

読み取り処理は `src/lib/roster-import-logic.mjs` にあります。

Excelの読み取り仕様:

- シート名は `クラス一覧表` を優先。なければ先頭シート
- 3行目以降を読み取る
- ファイル名から学年を判定する
- 生徒番号・生徒名・担任が空の行は取り込まない
- 生徒番号が数字だけでない行は取り込まない

列対応:

| Excel列 | DB項目 |
|---|---|
| A列 | 校舎 |
| B列 | 生徒番号 |
| C列 | 生徒名 |
| D列 | 性別 |
| E列 | 学校名 |
| F列 | 担任 |
| G/H列 | 数学の教室/クラス |
| J/K列 | 英語の教室/クラス |
| M/N列 | 国語の教室/クラス |

校舎は `本` を `本校`、`南` を `南教室` に正規化します。

## 取り込み方法

CLI:

```bash
npm run import:roster
```

強制取り込み:

```bash
npm run import:roster -- --force
```

プレビュー:

```bash
npm run import:roster -- --preview
```

取り込みは `app_settings` の `roster_excel_import_manifest` に、前回取り込んだExcelファイル名・サイズ・更新時刻を保存します。

通常実行では、前回からExcelファイルが変わっていない場合はスキップします。`--force` を付けると変化がなくても取り込みます。

注意:

- `student_roster` は生徒番号単位で upsert されます。
- `student_class_enrollments` は全件削除してから再作成されます。
- 本番で実行する前は、対象テーブルのバックアップを取るのが安全です。

## 管理画面

画面から確認する場合:

```text
/admin/notion-roster
```

この画面では、Notion生徒情報・クラス一覧Excel・アプリ側名簿の差分を照合し、選択した生徒だけをアプリ側名簿へ反映できます。

画面上のボタン:

- `Notion + Excelを照合`
- `選択した差分を反映`

LINE紐づけはこの画面では変更しません。

## LINE紐づけでの考え方

LINE管理名には、現在在籍している生徒だけでなく、過去に在籍した兄姉の名前が含まれることがあります。

運用ルール:

- 管理名に `student_roster` 上の現在対象生徒が1名だけ含まれる場合は、その生徒の父母・本人として自動紐づけしてよい
- 管理名に `student_roster` 上の現在対象生徒が複数含まれる場合は、人が確認する
- 管理名に `student_roster` 上の生徒が含まれない場合は、卒業生・退塾生・名簿未同期・管理名不足として確認する

つまり、LINE紐づけでは `student_roster` を「アプリが現在対象として扱う生徒一覧」として使います。

## 関連スクリプト

- `scripts/import-roster-from-excel.mjs`
  - Excelから `student_roster` と `student_class_enrollments` を作る
- `scripts/import-line-manager-aliases.mjs`
  - LINE管理画面で付けた管理名を `line_user_aliases` に取り込む
- `scripts/link-line-history-via-manager-names.mjs`
  - LINE管理名と名簿を照合し、LINEアカウントと生徒の自動紐づけ候補を作る
- `scripts/link-students-from-line-history.mjs`
  - LINE履歴本文・プロフィール名・管理名から生徒候補を作る

## 今回確認したこと

2026-08-06時点で確認した事実:

- `student_roster` は `supabase/schema.sql` で定義されている
- `npm run import:roster` がクラス一覧Excelから `student_roster` を作る
- `src/lib/roster-import-logic.mjs` が列対応・ファイル判定・差分判定を持っている
- `/admin/notion-roster` から Notion・Excel・アプリ側名簿の差分確認と選択反映ができる
- LINE紐づけは `student_roster` に対象生徒が存在しないと外部キー制約で登録できない
